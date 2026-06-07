import { Job } from "bullmq";
import { PlumberClient } from "./plumber.js";
import { db } from "../db/index.js";
import { species, occurrences, projectMembers } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { jobEventBus } from "./job-events.js";
import { CLIMATE_DOWNLOAD_POLL_INTERVAL_MS, CLIMATE_DOWNLOAD_MAX_ATTEMPTS, SdmJobData, SdmJobResult } from "./queue.js";

export async function handleCleanJob(
  job: Job<SdmJobData, SdmJobResult>,
  client: PlumberClient,
  userId: string | undefined,
): Promise<SdmJobResult> {
  const { payload } = job.data;

  await job.updateProgress(20);
  jobEventBus.emitJobStatus({
    jobId: job.id!,
    state: "active",
    progress: 20,
  });

  const cleanRes = await client.cleanOccurrences({
    file_id: payload.file_id as string,
    min_source_records: Number(payload.min_source_records) || 15,
    merge_small_sources: payload.merge_small_sources !== false,
    use_cc: Boolean(payload.use_cc),
    cc_tests: (payload.cc_tests as string) || "all",
    pipelineRunId: (payload.pipelineRunId as string) || null,
  });

  const cleanJobId = cleanRes.job_id as string | undefined;

  if (cleanJobId) {
    let cleanStatus: Record<string, unknown> = {};
    let cleanCompleted = false;
    let cleanAttempts = 0;

    while (!cleanCompleted && cleanAttempts < CLIMATE_DOWNLOAD_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, CLIMATE_DOWNLOAD_POLL_INTERVAL_MS));
      cleanAttempts++;

      try {
        cleanStatus = await client.getJobStatus(cleanJobId);
        const runStatus = cleanStatus.status as string | undefined;

        if (runStatus === "running") {
          const pct = Math.min(90, 20 + Math.round(cleanAttempts * 2));
          await job.updateProgress(pct);
          jobEventBus.emitJobStatus({ jobId: job.id!, state: "active", progress: pct });
        }

        if (runStatus === "completed") {
          cleanCompleted = true;
          const cleanResult = cleanStatus.result as Record<string, unknown> | undefined;

          if (cleanResult) {
            const speciesName = (payload.species as string) || "Untitled species";
            const pipelineRunId = (payload.pipelineRunId as string) || null;

            if (userId) {
              const [membership] = await db
                .select({ projectId: projectMembers.projectId })
                .from(projectMembers)
                .where(eq(projectMembers.userId, userId))
                .limit(1);

              const projectId = membership?.projectId;

              if (projectId) {
                let [sp] = await db
                  .select()
                  .from(species)
                  .where(and(eq(species.name, speciesName), eq(species.projectId, projectId)))
                  .limit(1);

                if (!sp) {
                  [sp] = await db
                    .insert(species)
                    .values({ name: speciesName, projectId, occurrenceCount: 0, userId })
                    .returning();
                }

                const cleanedRecords = cleanResult.cleaned_records as Array<Record<string, unknown>> | undefined;
                const validRecords = (cleanedRecords || []).filter(
                  (r) => typeof r.longitude === "number" && typeof r.latitude === "number" && isFinite(r.longitude) && isFinite(r.latitude)
                );

                if (validRecords.length > 0) {
                  const recordsToInsert = validRecords.map((row) => ({
                    speciesId: sp.id,
                    projectId,
                    userId,
                    filePath: (cleanResult.cleaned_file_id as string) || null,
                    pipelineRunId,
                    longitude: Number(row.longitude),
                    latitude: Number(row.latitude),
                    source: (row.source as string) || null,
                    flagged: Boolean((row as { flagged?: unknown }).flagged || (row as { cc_flag?: unknown }).cc_flag),
                    cleaned: true,
                    raw: row,
                  }));

                  const BATCH_SIZE = 500;
                  for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
                    const batch = recordsToInsert.slice(i, i + BATCH_SIZE);
                    await db.insert(occurrences).values(batch);
                  }

                  await db
                    .update(species)
                    .set({ occurrenceCount: (sp.occurrenceCount || 0) + recordsToInsert.length })
                    .where(eq(species.id, sp.id));
                }
              }
            }
          }

          await job.updateProgress(100);
          jobEventBus.emitJobStatus({
            jobId: job.id!,
            state: "completed",
            progress: 100,
            result: cleanResult || cleanStatus,
          });
          return { status: "success", data: cleanResult || cleanStatus };
        } else if (runStatus === "failed") {
          cleanCompleted = true;
          const cleanError = (cleanStatus.error as string) || "Clean job failed";
          const cleanErrCode = cleanStatus.error_code as string | undefined;
          const cleanErrHint = cleanStatus.error_hint as string | undefined;
          await job.updateProgress(100);
          jobEventBus.emitJobStatus({
            jobId: job.id!,
            state: "failed",
            progress: 100,
            failedReason: cleanError,
          });
          return { status: "error", error: cleanError, error_code: cleanErrCode ?? null, error_hint: cleanErrHint ?? null };
        }
      } catch (pollErr) {
        const pollMsg = pollErr instanceof Error ? pollErr.message : String(pollErr);
        console.warn(`[queue] Polling error for clean job ${job.id}: ${pollMsg}`);
      }
    }

    if (!cleanCompleted) {
      jobEventBus.emitJobStatus({
        jobId: job.id!,
        state: "failed",
        progress: 0,
        failedReason: "Polling timeout: clean job did not complete in time",
      });
      return { status: "error", error: "Polling timeout: clean job did not complete in time" };
    }
  } else {
    await job.updateProgress(100);
    jobEventBus.emitJobStatus({
      jobId: job.id!,
      state: "failed",
      progress: 100,
      failedReason: "Clean job submission returned no job_id",
    });
    return { status: "error", error: "Clean job submission returned no job_id" };
  }

  return { status: "error", error: "Job processing failed" };
}
