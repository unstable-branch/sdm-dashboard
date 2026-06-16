import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { runs, projects, users } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";
import { extractProgressPercent } from "@sdm/shared";
import { readFile } from "fs/promises";
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve, extname } from "path";
import { uploadFile, getBucketNames, getDirSize } from "./storage.js";
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

export interface PlumberModelStatus {
  status: string;
  progress_log?: string[];
  progress_json?: unknown;
  error?: string | null;
  last_stage?: string | null;
  error_code?: string | null;
  error_hint?: string | null;
  metrics?: Record<string, unknown> | null;
  output_files?: { tif_3857?: string } | null;
}

const consecutive404s = new Map<string, Consecutive404>();

function extractHttpStatusCode(msg: string): number | null {
  // Match explicit HTTP status patterns only — avoids false positives from arbitrary 3-digit numbers.
  // These patterns cover: "status: 404", "HTTP/1.1 404", "HTTP 404", "status code 404",
  // and our own error format: "Failed to X: 404 ..."
  const patterns = [
    /status:\s*(\d{3})/i,
    /HTTP\/\d\.\d\s+(\d{3})/,
    /HTTP\s+(\d{3})/,
    /status code (\d{3})/i,
    /:\s*(404|408|429|500|502|503|504)\b/,
  ];
  for (const pat of patterns) {
    const m = msg.match(pat);
    if (m) return parseInt(m[1], 10);
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

    // Detect runs stuck in "queued" status — if a job hasn't been picked up by the worker
    // within 5 minutes of creation, mark it as failed (worker may be offline or crashed)
    const queuedCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stuckQueuedRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.status, "queued"), sql`${runs.createdAt} < ${queuedCutoff}`));
    for (const qr of stuckQueuedRuns) {
      await db
        .update(runs)
        .set({
          status: "failed",
          error: "Model run was queued but never started — worker may be offline or all retries exhausted",
          errorCode: "WORKER_ORPHAN",
          completedAt: new Date(),
        })
        .where(eq(runs.id, qr.id));
      jobEventBus.emitJobStatus({
        jobId: qr.id,
        state: "failed",
        progress: 0,
        failedReason: "Model run was queued but never started — worker may be offline",
        error_code: "WORKER_ORPHAN",
      });
    }

    const activeRuns = await db
      .select({ id: runs.id, jobId: runs.jobId, status: runs.status, startedAt: runs.startedAt, projectId: runs.projectId })
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
              errorCode: "PLUMBER_TIMEOUT",
              errorHint: "The R computation exceeded the timeout. Simplify the model or increase the timeout limit.",
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
        const status = await client.getModelStatus(run.jobId) as unknown as PlumberModelStatus;
        const plumberStatus = status.status;

        // Guard: re-check DB status in case cancel route changed it since the query above
        const [currentRun] = await db
          .select({ status: runs.status })
          .from(runs)
          .where(eq(runs.id, run.id))
          .limit(1);
        if (currentRun && currentRun.status !== "running") continue;
        const logs = Array.isArray(status.progress_log) ? status.progress_log as string[] : [];
        const progressJson = status.progress_json;
        const error = status.error;
        const plumberLastStage = status.last_stage;

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
            currentStage: plumberLastStage ?? null,
            progressJson,
          });
        } else if (plumberStatus === "loading" || plumberStatus === "pending") {
          // Forward progress logs even during initialization phases
          if (plumberLastStage) {
            await db
              .update(runs)
              .set({ lastStage: plumberLastStage })
              .where(eq(runs.id, run.id));
          }

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: plumberStatus === "loading" ? "loading" : "pending",
            progress: 0,
            logs,
            currentStage: plumberLastStage ?? null,
            progressJson,
          });
        } else if (plumberStatus === "completed") {
          // Guard: skip if queue worker already completed this run
          const [currentRun] = await db
            .select({ status: runs.status })
            .from(runs)
            .where(eq(runs.id, run.id))
            .limit(1);
          if (currentRun && currentRun.status !== "running") continue;

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

          // Calculate run output directory size and add to user storage
          let runSize = 0;
          if (run.jobId) {
            const jobDir = join(PROJECT_ROOT, "outputs", "jobs", run.jobId);
            runSize = getDirSize(jobDir);
          }

          await db
            .update(runs)
            .set({
              status: "completed",
              metrics: status.metrics ?? null,
              outputFiles: status.output_files ?? null,
              completedAt: new Date(),
              progressLog: logs.length > 0 ? logs : undefined,
              provenance,
              runStorageBytes: runSize,
            })
            .where(eq(runs.id, run.id));

          // Add run output size to user's total storage
          if (runSize > 0 && run.projectId) {
            try {
              const [project] = await db
                .select({ ownerId: projects.ownerId })
                .from(projects)
                .where(eq(projects.id, run.projectId))
                .limit(1);
              if (project) {
                await db
                  .update(users)
                  .set({ storageUsedBytes: sql`${users.storageUsedBytes} + ${runSize}` })
                  .where(eq(users.id, project.ownerId));
              }
            } catch { /* best-effort */ }
          }

          // Upload the 3857 COG to Garage S3 for TiTiler serving
          const tif3857Path = status.output_files?.tif_3857;
          if (tif3857Path) {
            uploadCogToGarage(tif3857Path, run.id).catch((err) => {
              console.warn(`[Garage] Failed to upload COG for run ${run.id}:`, err instanceof Error ? err.message : err);
            });
          }

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "completed",
            progress: 100,
            logs,
            result: status as unknown as Record<string, unknown>,
            progressJson,
          });

          // Encrypt output files at rest (after event so frontend gets completion before encryption)
          if (run.jobId) {
            const jobDir = join(PROJECT_ROOT, "outputs", "jobs", run.jobId);
            encryptOutputs(jobDir);
          }
        } else if (plumberStatus === "failed") {
          const errorCode = status.error_code;
          const errorHint = status.error_hint;
          await db
            .update(runs)
            .set({
              status: "failed",
              error: error ?? "Model run failed",
              errorCode: errorCode ?? null,
              errorHint: errorHint ?? null,
              completedAt: new Date(),
              progressLog: logs.length > 0 ? logs : undefined,
              provenance: errorCode ? { error_code: errorCode, error_hint: errorHint } : undefined,
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "failed",
            progress: 0,
            logs,
            failedReason: error ?? "Model run failed",
            error_code: status.error_code as string | undefined,
            error_hint: (status as any).error_hint as string | undefined,
            progressJson,
          });
        } else if (plumberStatus === "cancelled") {
          await db
            .update(runs)
            .set({
              status: "cancelled",
              completedAt: new Date(),
              progressLog: logs.length > 0 ? logs : undefined,
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
          // Final check: fetch Plumber status directly to see if the run actually completed
          // (404 may have been transient; 500 may be Plumber auth-crash window — retry)
          let plumberErrorDetail = "";
          let finalPlumberStatus: string | undefined;
          const MAX_500_RETRIES = 2;
          const RETRY_DELAY_MS = 5000;
          for (let attempt = 0; attempt <= MAX_500_RETRIES; attempt++) {
            try {
              if (attempt > 0) {
                console.warn(`[plumber-sync] Retry #${attempt} for run ${run.id} after 500...`);
                await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
              }
              const probeRes = await fetch(
                `${process.env.PLUMBER_URL || "http://localhost:8000"}/api/v1/models/status/${run.jobId}`,
                {
                  headers: { "X-Hono-Internal": process.env.PLUMBER_INTERNAL_KEY || "" },
                  signal: AbortSignal.timeout(3000),
                },
              );
              const probeBody = await probeRes.text().catch(() => "");
              plumberErrorDetail = `probe_status=${probeRes.status} body=${probeBody.slice(0, 500)}`;
              // Try to parse probe response — if Plumber reports a terminal state, use it
              if (probeRes.ok) {
                const probeJson = JSON.parse(probeBody);
                const ps = probeJson.status as string;
                if (["completed", "failed", "cancelled"].includes(ps)) {
                  finalPlumberStatus = ps;
                  await db.update(runs).set({
                    status: ps as "completed" | "failed" | "cancelled",
                    error: ps === "failed" ? ((probeJson.error as string) || "Model run failed") : null,
                    errorCode: ps === "failed" ? (probeJson.error_code as string ?? null) : null,
                    errorHint: ps === "failed" ? (probeJson.error_hint as string ?? null) : null,
                    metrics: ps === "completed" ? (probeJson.metrics ?? null) : null,
                    outputFiles: ps === "completed" ? (probeJson.output_files ?? null) : null,
                    completedAt: new Date(),
                  }).where(eq(runs.id, run.id));
                  jobEventBus.emitJobStatus({
                    jobId: run.id,
                    state: ps,
                    progress: ps === "completed" ? 100 : 0,
                    logs: Array.isArray(probeJson.progress_log) ? probeJson.progress_log : [],
                    result: ps === "completed" ? probeJson : undefined,
                    failedReason: ps === "failed" ? (probeJson.error as string | undefined) || undefined : undefined,
                    progressJson: probeJson.progress_json ?? null,
                  });
                  consecutive404s.delete(run.id);
                  console.warn(`[plumber-sync] Probe found terminal status "${ps}" for run ${run.id} — recovering from 404 streak.`);
                  plumberErrorDetail = ""; // clear so we don't fail below
                  break;
                }
              }
              // 500 error with retries left — continue the loop
              if (probeRes.status === 500 && attempt < MAX_500_RETRIES) {
                continue;
              }
            } catch (probeErr) {
              plumberErrorDetail = `probe_failed=${probeErr instanceof Error ? probeErr.message.slice(0, 200) : "unknown"}`;
            }
            // Non-500 or retries exhausted: stop retrying
            break;
          }
          // If we recovered via a terminal status above, skip the fail path
          if (finalPlumberStatus) continue;

          console.error(
            `[plumber-sync] Marking run ${run.id} as failed: ` +
            `consecutive_404s=${existing.count}, ` +
            `time_since_first=${Math.round(timeSinceFirst / 1000)}s, ` +
            `plumber_url=${process.env.PLUMBER_URL || "http://localhost:8000"}, ` +
            plumberErrorDetail
          );

          const failedReason = `Process crashed or was killed before status could be recorded. ${plumberErrorDetail}`;

          await db
            .update(runs)
            .set({
              status: "failed",
              error: failedReason,
              errorCode: "PROCESS_CRASH",
              errorHint: "The R computation process was killed (OOM, segfault, or signal). Check memory, reduce resolution, or use fewer covariates.",
              completedAt: new Date(),
            })
            .where(eq(runs.id, run.id));

          jobEventBus.emitJobStatus({
            jobId: run.id,
            state: "failed",
            progress: 0,
            failedReason,
            progressJson: null,
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
