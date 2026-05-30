import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";
import { extractProgressPercent } from "@sdm/shared";

const client = new PlumberClient();
let _syncInterval: ReturnType<typeof setInterval> | null = null;
let _running = false;

const STALLED_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours — mark as failed if no progress
const GRACE_PERIOD_MS = parseInt(process.env.SDM_STARTUP_GRACE_PERIOD_MS || "60000", 10);
const CONSECUTIVE_404_THRESHOLD = parseInt(process.env.SDM_CONSECUTIVE_404_THRESHOLD || "3", 10);
const CONSECUTIVE_404_WINDOW_MS = 30_000; // require 404s within this window
const MAX_404_ENTRIES = 200; // cap map size to prevent memory leak

interface Consecutive404 {
  count: number;
  firstSeen: number;
}

const consecutive404s = new Map<string, Consecutive404>();

function extractHttpStatusCode(msg: string): number | null {
  const match = msg.match(/status:\s*(\d{3})/);
  if (match) return parseInt(match[1], 10);
  const bareMatch = msg.match(/\b(\d{3})\b/);
  if (bareMatch) {
    const code = parseInt(bareMatch[1], 10);
    if (code >= 100 && code < 600) return code;
  }
  return null;
}

function cleanupOld404Entries() {
  const now = Date.now();
  for (const [id, entry] of consecutive404s.entries()) {
    if (now - entry.firstSeen > CONSECUTIVE_404_WINDOW_MS * 3) {
      consecutive404s.delete(id);
    }
  }
  if (consecutive404s.size > MAX_404_ENTRIES) {
    const oldest = Array.from(consecutive404s.entries())
      .sort((a, b) => a[1].firstSeen - b[1].firstSeen)
      .slice(0, consecutive404s.size - MAX_404_ENTRIES);
    for (const [id] of oldest) consecutive404s.delete(id);
  }
}

async function syncRunningJobs() {
  if (_running) return;
  _running = true;

  try {
    cleanupOld404Entries();

    const activeRuns = await db
      .select({ id: runs.id, jobId: runs.jobId, status: runs.status, startedAt: runs.startedAt })
      .from(runs)
      .where(and(eq(runs.status, "running")));

    for (const run of activeRuns) {
      if (!run.jobId) continue;

      if (run.startedAt) {
        const ageMs = Date.now() - new Date(run.startedAt).getTime();
        if (ageMs > STALLED_RUN_TIMEOUT_MS) {
          await db
            .update(runs)
            .set({
              status: "failed",
              error: `Run timed out after ${Math.round(ageMs / 3600000)} hours with no completion`,
              completedAt: new Date(),
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "failed",
            progress: 0,
            failedReason: `Run timed out after ${Math.round(ageMs / 3600000)} hours with no completion`,
          });
          consecutive404s.delete(run.id);
          continue;
        }
      }

      try {
        const status = await client.getModelStatus(run.jobId);
        const plumberStatus = (status as any).status as string;
        const logs = Array.isArray((status as any).progress_log) ? (status as any).progress_log : [];
        const error = (status as any).error as string | undefined;
        const plumberLastStage = (status as any).last_stage as string | undefined;

        consecutive404s.delete(run.id);

        if (plumberStatus === "running") {
          const pct = (() => {
            for (let i = logs.length - 1; i >= 0; i--) {
              const p = extractProgressPercent(logs[i]);
              if (p !== undefined) return p;
            }
            return undefined;
          })();

          if (plumberLastStage) {
            await db
              .update(runs)
              .set({ lastStage: plumberLastStage })
              .where(eq(runs.id, run.id));
          }

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "active",
            progress: pct ?? 50,
            logs,
          });
        } else if (plumberStatus === "completed") {
          await db
            .update(runs)
            .set({
              status: "completed",
              metrics: (status as any).metrics ?? null,
              outputFiles: (status as any).output_files ?? null,
              completedAt: new Date(),
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "completed",
            progress: 100,
            logs,
            result: status,
          });
        } else if (plumberStatus === "failed") {
          await db
            .update(runs)
            .set({
              status: "failed",
              error: error ?? "Model run failed",
              completedAt: new Date(),
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "failed",
            progress: 0,
            logs,
            failedReason: error ?? "Model run failed",
          });
        } else if (plumberStatus === "cancelled") {
          await db
            .update(runs)
            .set({
              status: "cancelled",
              completedAt: new Date(),
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "cancelled",
            progress: 0,
            logs,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const statusCode = extractHttpStatusCode(msg);

        if (statusCode !== 404) {
          console.warn(`[plumber-sync] Transient error for run ${run.id} (HTTP ${statusCode ?? "N/A"}): ${msg}`);
          continue;
        }

        const runRow = await db
          .select({ startedAt: runs.startedAt, createdAt: (runs as any).createdAt })
          .from(runs)
          .where(eq(runs.id, run.id))
          .limit(1);

        if (runRow.length > 0) {
          const startedAt = runRow[0].startedAt;
          const createdAt = runRow[0].createdAt;
          const referenceDate = startedAt || createdAt;

          if (referenceDate) {
            const ageMs = Date.now() - new Date(referenceDate).getTime();
            if (ageMs < GRACE_PERIOD_MS) {
              continue;
            }
          }
        }

        const existing = consecutive404s.get(run.id);
        if (!existing) {
          consecutive404s.set(run.id, { count: 1, firstSeen: Date.now() });
          console.warn(`[plumber-sync] First 404 for run ${run.id}, awaiting ${CONSECUTIVE_404_THRESHOLD - 1} more...`);
          continue;
        }

        existing.count++;
        const timeSinceFirst = Date.now() - existing.firstSeen;

        if (existing.count >= CONSECUTIVE_404_THRESHOLD && timeSinceFirst >= CONSECUTIVE_404_WINDOW_MS) {
          console.error(
            `[plumber-sync] Marking run ${run.id} as failed: ` +
            `consecutive_404s=${existing.count}, ` +
            `time_since_first=${Math.round(timeSinceFirst / 1000)}s, ` +
            `plumber_url=${process.env.PLUMBER_URL || "http://localhost:8000"}`
          );

          await db
            .update(runs)
            .set({
              status: "failed",
              error: "Process crashed or was killed before status could be recorded",
              completedAt: new Date(),
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "failed",
            progress: 0,
            failedReason: "Process crashed or was killed before status could be recorded",
          });

          consecutive404s.delete(run.id);
        } else {
          console.warn(
            `[plumber-sync] 404 #${existing.count} for run ${run.id} ` +
            `(${Math.round(timeSinceFirst / 1000)}s elapsed), ` +
            `not yet marking failed (need ${CONSECUTIVE_404_THRESHOLD})`
          );
        }
      }
    }
  } catch (err) {
    console.error("[plumber-sync] Sync error:", err instanceof Error ? err.message : err);
  } finally {
    _running = false;
  }
}

export function startPlumberSync(intervalMs = 5000) {
  if (_syncInterval) return;
  console.log(`[plumber-sync] Starting sync every ${intervalMs}ms`);
  syncRunningJobs();
  _syncInterval = setInterval(syncRunningJobs, intervalMs);
}

export function stopPlumberSync() {
  if (_syncInterval) {
    clearInterval(_syncInterval);
    _syncInterval = null;
    console.log("[plumber-sync] Stopped");
  }
}
