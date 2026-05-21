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

  async uploadOccurrence(file: Buffer | string, filename?: string): Promise<Record<string, unknown>> {
    if (typeof file === "string") {
      const res = await fetch(`${this.baseUrl}/api/v1/occurrences/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: file, file_id: filename }),
      });
      if (!res.ok) throw new Error(`Failed to upload occurrence: ${res.status}`);
      return res.json();
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(file)]);
    formData.append("file", blob, filename || "upload.csv");

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

  async runModel(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/models/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to run model: ${res.status}`);
    return res.json();
  }

  async downloadClimate(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/climate/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to download climate: ${res.status}`);
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

  async fitModel(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/models/fit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to fit model: ${res.status}`);
    return res.json();
  }

  async predict(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/models/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to predict: ${res.status}`);
    return res.json();
  }

  async generateReport(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/output/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to generate report: ${res.status}`);
    return res.json();
  }

  async getModelStatus(jobId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/models/status/${jobId}`);
    if (!res.ok) throw new Error(`Failed to get model status: ${res.status}`);
    return res.json();
  }

  async cancelModel(jobId: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/models/cancel/${jobId}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`Failed to cancel model: ${res.status}`);
    return res.json();
  }

  async getModelRuns(): Promise<Array<Record<string, unknown>>> {
    const res = await fetch(`${this.baseUrl}/api/v1/models/runs`);
    if (!res.ok) throw new Error(`Failed to get model runs: ${res.status}`);
    return res.json();
  }

  async getFutureScenarios(): Promise<{ available_scenarios: Array<Record<string, unknown>>; base_directory: string; message?: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/future/scenarios`);
    if (!res.ok) throw new Error(`Failed to get future scenarios: ${res.status}`);
    return res.json();
  }

  async getClimateScenarios(): Promise<{ scenarios: Array<Record<string, unknown>> }> {
    const res = await fetch(`${this.baseUrl}/api/v1/climate/scenarios`);
    if (!res.ok) throw new Error(`Failed to get climate scenarios: ${res.status}`);
    return res.json();
  }

  async deleteClimateScenario(scenarioId: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/climate/delete/${scenarioId}`, { method: "POST" });
    if (!res.ok) throw new Error(`Failed to delete scenario: ${res.status}`);
    return res.json();
  }

  async getClimateStatus(jobId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/climate/status/${jobId}`);
    if (!res.ok) throw new Error(`Failed to get climate status: ${res.status}`);
    return res.json();
  }

  async getEcologyData(runId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/ecology/${runId}`);
    if (!res.ok) throw new Error(`Failed to get ecology data: ${res.status}`);
    return res.json();
  }

  async getEooAoo(runId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/ecology/${runId}/eoo-aoo`);
    if (!res.ok) throw new Error(`Failed to get EOO/AOO: ${res.status}`);
    return res.json();
  }

  async getAoa(runId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/ecology/${runId}/aoa`);
    if (!res.ok) throw new Error(`Failed to get AOA: ${res.status}`);
    return res.json();
  }

  async getEcologyReport(runId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/v1/ecology/${runId}/report`);
    if (!res.ok) throw new Error(`Failed to get ecology report: ${res.status}`);
    return res.text();
  }
}

export const plumberClient = new PlumberClient();
