import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and, ne } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";

const client = new PlumberClient();
let _syncInterval: ReturnType<typeof setInterval> | null = null;
let _running = false;

async function syncRunningJobs() {
  if (_running) return;
  _running = true;

  try {
    const activeRuns = await db
      .select({ id: runs.id, jobId: runs.jobId, status: runs.status })
      .from(runs)
      .where(and(eq(runs.status, "running")));

    for (const run of activeRuns) {
      if (!run.jobId) continue;

      try {
        const status = await client.getModelStatus(run.jobId);
        const plumberStatus = (status as any).status as string;
        const logs = Array.isArray((status as any).progress_log) ? (status as any).progress_log : [];
        const error = (status as any).error as string | undefined;

        if (plumberStatus === "running") {
          const pct = (() => {
            for (let i = logs.length - 1; i >= 0; i--) {
              const m = logs[i].match(/\[(\d+)%\]/);
              if (m) return Math.min(100, parseInt(m[1], 10));
            }
            return undefined;
          })();

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
        if (msg.includes("404")) {
          // Job not found in Plumber — likely crashed before meta.json was written
          // Check if it's been running for less than 30 seconds (transient)
          const runRow = await db
            .select({ startedAt: runs.startedAt })
            .from(runs)
            .where(eq(runs.id, run.id))
            .limit(1);

          if (runRow.length > 0 && runRow[0].startedAt) {
            const ageMs = Date.now() - new Date(runRow[0].startedAt).getTime();
            if (ageMs < 30_000) {
              // Too new, skip — might be transient
              continue;
            }
          }

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
