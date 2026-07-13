import type { PlumberClient } from "./plumber.js";

export async function completedRunFields(
  client: PlumberClient,
  plumberJobId: string,
  modelStatus: Record<string, unknown>,
): Promise<{
  metrics: Record<string, unknown>;
  outputFiles: Record<string, string> | null;
  provenance: Record<string, unknown> | null;
}> {
  const metrics = (modelStatus.metrics as Record<string, unknown> | undefined) ?? {};
  const outputFiles = (modelStatus.output_files as Record<string, string> | undefined) ?? null;
  let provenance: Record<string, unknown> | null = null;
  try {
    const manifestResponse = await client.getOutputManifest(plumberJobId);
    const manifest = manifestResponse.manifest;
    provenance = manifest && typeof manifest === "object"
      ? manifest as Record<string, unknown>
      : manifestResponse;
  } catch {
    // Provenance is best-effort; completion and artifact persistence are authoritative.
  }
  return { metrics, outputFiles, provenance };
}
