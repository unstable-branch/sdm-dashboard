export function jobDurationMs(state: string | undefined, startedAt: string | undefined, completedAt: string | undefined, now: number): number | null {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const terminal = state === "completed" || state === "failed" || state === "cancelled";
  const end = terminal ? (completedAt ? Date.parse(completedAt) : NaN) : now;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}
