import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";
import { extractProgressPercent } from "@sdm/shared";
import { readFile } from "fs/promises";
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve, extname } from "path";
import { uploadFile, getBucketNames } from "./storage.js";
import { encrypt } from "./encryption.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");

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
        const progressJson = (status as any).progress_json;
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
            currentStage: currentStage?.stage ?? null,
            progressJson,
          });
        } else if (plumberStatus === "completed") {
          // Fetch provenance manifest from Plumber
          let provenance = null;
          try {
            const manifestRes = await fetch(
              `${process.env.PLUMBER_URL || "http://localhost:8000"}/api/v1/output/manifest/${run.jobId}`,
              {
                headers: {
                  ...(process.env.PLUMBER_INTERNAL_KEY ? { "X-Hono-Internal": process.env.PLUMBER_INTERNAL_KEY } : {}),
                },
              },
            );
            if (manifestRes.ok) {
              const manifestData = await manifestRes.json();
              provenance = manifestData.manifest || null;
            }
          } catch {
            // Manifest fetch is best-effort
          }

          await db
            .update(runs)
            .set({
              status: "completed",
              metrics: (status as any).metrics ?? null,
              outputFiles: (status as any).output_files ?? null,
              completedAt: new Date(),
              progressLog: progressJson ?? undefined,
              provenance,
            })
            .where(eq(runs.id, run.id));

          // Upload the 3857 COG to Garage S3 for TiTiler serving
          const tif3857Path = (status as any)?.output_files?.tif_3857;
          if (tif3857Path) {
            uploadCogToGarage(tif3857Path, run.id).catch((err) => {
              console.warn(`[Garage] Failed to upload COG for run ${run.id}:`, err instanceof Error ? err.message : err);
            });
          }

          // Encrypt output files at rest
          if (run.jobId) {
            const jobDir = join(PROJECT_ROOT, "outputs", "jobs", run.jobId);
            encryptOutputs(jobDir);
          }

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "completed",
            progress: 100,
            logs,
            result: status as Record<string, unknown>,
            progressJson,
          });
        } else if (plumberStatus === "failed") {
          const errorCode = (status as any).error_code as string | undefined;
          const errorHint = (status as any).error_hint as string | undefined;
          await db
            .update(runs)
            .set({
              status: "failed",
              error: error ?? "Model run failed",
              completedAt: new Date(),
              progressLog: progressJson ?? undefined,
              provenance: errorCode ? { error_code: errorCode, error_hint: errorHint } : undefined,
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "failed",
            progress: 0,
            logs,
            failedReason: error ?? "Model run failed",
            progressJson,
          });
        } else if (plumberStatus === "cancelled") {
          await db
            .update(runs)
            .set({
              status: "cancelled",
              completedAt: new Date(),
              progressLog: progressJson ?? undefined,
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "cancelled",
            progress: 0,
            logs,
            progressJson,
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

async function uploadCogToGarage(containerPath: string, runId: string): Promise<void> {
  let hostPath = containerPath;
  if (hostPath.startsWith("/app/")) {
    hostPath = join(PROJECT_ROOT, hostPath.slice(5));
  }
  const data = await readFile(hostPath);
  const { rasters } = getBucketNames();
  const objectName = `runs/${runId}/suitability_3857.tif`;
  await uploadFile(rasters, objectName, data, "image/tiff");
  console.log(`[Garage] Uploaded COG for run ${runId}: runs/${runId}/suitability_3857.tif`);
}

// Do NOT encrypt metadata files (.json, .rds, .txt) — Plumber's own
// diagnostics and status endpoints need to read these as plaintext.
// Only encrypt raw spatial/output data files.
const ENCRYPTABLE_EXTENSIONS = new Set([
  ".tif", ".tiff", ".csv", ".png",
]);

function encryptOutputs(jobDir: string) {
  let files: string[];
  try {
    files = readdirSync(jobDir);
  } catch {
    return;
  }
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (!ENCRYPTABLE_EXTENSIONS.has(ext)) continue;
    const fp = join(jobDir, f);
    const encPath = fp + ".enc";
    if (existsSync(encPath)) continue;
    try {
      const data = readFileSync(fp);
      const encrypted = encrypt(data);
      writeFileSync(encPath, encrypted);
      rmSync(fp);
    } catch (err) {
      console.warn(`[encrypt] Failed to encrypt ${fp}:`, err);
    }
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
