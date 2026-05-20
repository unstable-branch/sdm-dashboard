const PLUMBER_URL = process.env.PLUMBER_URL || "http://localhost:8000";

export class PlumberClient {
  private baseUrl: string;

  constructor(baseUrl: string = PLUMBER_URL) {
    this.baseUrl = baseUrl;
  }

  async healthCheck(): Promise<{ status: string; r_version: string; timestamp: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`Plumber health check failed: ${res.status}`);
    return res.json();
  }

  async getConfigDefaults(): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/config/defaults`);
    if (!res.ok) throw new Error(`Failed to get config defaults: ${res.status}`);
    return res.json();
  }

  async getModels(): Promise<Array<{ id: string; label: string }>> {
    const res = await fetch(`${this.baseUrl}/api/v1/models`);
    if (!res.ok) throw new Error(`Failed to get models: ${res.status}`);
    return res.json();
  }

  async uploadOccurrence(file: Buffer, filename: string): Promise<Record<string, unknown>> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(file)]);
    formData.append("file", blob, filename);

    const res = await fetch(`${this.baseUrl}/api/v1/occurrences/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(`Failed to upload occurrence: ${res.status}`);
    return res.json();
  }

  async cleanOccurrences(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/occurrences/clean`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to clean occurrences: ${res.status}`);
    return res.json();
  }

  async searchGbif(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/occurrences/gbif/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to search GBIF: ${res.status}`);
    return res.json();
  }

  async parseDwca(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/occurrences/dwca`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to parse DwCA: ${res.status}`);
    return res.json();
  }

  async runModel(data: Record<string, unknown>): Promise<{ jobId: string; status: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/models/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to run model: ${res.status}`);
    return res.json();
  }

  async getJobStatus(jobId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/jobs/${jobId}`);
    if (!res.ok) throw new Error(`Failed to get job status: ${res.status}`);
    return res.json();
  }

  async cancelJob(jobId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/v1/jobs/${jobId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to cancel job: ${res.status}`);
    return res.json();
  }
}

export const plumberClient = new PlumberClient();
