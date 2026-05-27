const PLUMBER_URL = process.env.PLUMBER_URL || "http://localhost:8000";
const PLUMBER_INTERNAL_KEY = process.env.PLUMBER_INTERNAL_KEY || "";
import { Agent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

const keepAliveAgent = new Agent({ keepAlive: true, keepAliveMsecs: 1000 });
const keepAliveHttpsAgent = new HttpsAgent({ keepAlive: true, keepAliveMsecs: 1000 });

const TIMEOUT_FAST = 10_000;
const TIMEOUT_NORMAL = 30_000;
const TIMEOUT_MODEL_RUN = 30 * 60 * 1000;
const TIMEOUT_CLIMATE = 60 * 60 * 1000;
const TIMEOUT_UPLOAD = 300_000;

export interface CleanResponse {
  job_id: string;
  status: string;
}

export interface ModelRunResponse extends Record<string, unknown> {
  job_id: string;
  status: string;
  message: string;
}

export interface ModelStatusResponse extends Record<string, unknown> {
  id?: string;
  status: string;
  progress?: number;
  progress_log?: string[];
  metrics?: Record<string, unknown>;
  error?: string;
  config?: Record<string, unknown>;
}

export interface AsyncJobStatusResponse extends Record<string, unknown> {
  available?: boolean;
  status?: string;
  error?: string;
  result?: Record<string, unknown>;
}

export interface EcologyDataResponse {
  run_id?: string;
  species?: string;
  model_id?: string;
  eoo_aoo?: Record<string, unknown>;
  error?: string;
}

export class PlumberClient {
  private baseUrl: string;
  private forwardedUser: string | null = null;

  constructor(baseUrl: string = PLUMBER_URL) {
    this.baseUrl = baseUrl;
  }

  withUser(userId: string): PlumberClient {
    const client = new PlumberClient(this.baseUrl);
    client.forwardedUser = userId;
    return client;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (PLUMBER_INTERNAL_KEY) h["X-Hono-Internal"] = PLUMBER_INTERNAL_KEY;
    if (this.forwardedUser) h["X-Forwarded-User"] = this.forwardedUser;
    return h;
  }

  private async _fetch(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const { timeout = TIMEOUT_NORMAL, ...fetchOpts } = options;
    const agent = url.startsWith("https") ? keepAliveHttpsAgent : keepAliveAgent;
    const res = await fetch(url, {
      ...fetchOpts,
      signal: AbortSignal.timeout(timeout),
      // @ts-expect-error - Node.js fetch supports agent despite TS types
      agent,
    });
    return res;
  }

  async healthCheck(): Promise<{ status: string; r_version: string; timestamp: string }> {
    const res = await this._fetch(`${this.baseUrl}/health`, { timeout: TIMEOUT_FAST });
    if (!res.ok) throw new Error(`Plumber health check failed: ${res.status}`);
    return res.json();
  }

  async getConfigDefaults(): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/config/defaults`, { timeout: TIMEOUT_FAST });
    if (!res.ok) throw new Error(`Failed to get config defaults: ${res.status}`);
    return res.json();
  }

  async getModels(): Promise<Array<{ id: string; label: string }>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models`, { timeout: TIMEOUT_FAST });
    if (!res.ok) throw new Error(`Failed to get models: ${res.status}`);
    return res.json();
  }

  async uploadOccurrence(file: Buffer | string, filename?: string): Promise<Record<string, unknown>> {
    const headers = this.headers();
    if (typeof file === "string") {
      const res = await this._fetch(`${this.baseUrl}/api/v1/occurrences/upload`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: file, file_id: filename }),
        timeout: TIMEOUT_UPLOAD,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `Failed to upload occurrence: ${res.status}`);
      }
      return res.json();
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(file)]);
    formData.append("file", blob, filename || "upload.csv");

    const res = await this._fetch(`${this.baseUrl}/api/v1/occurrences/upload`, {
      method: "POST",
      body: formData,
      headers,
      timeout: TIMEOUT_UPLOAD,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(body || `Failed to upload occurrence: ${res.status}`);
    }
    return res.json();
  }

  async cleanOccurrences(data: Record<string, unknown>): Promise<CleanResponse> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/occurrences/clean`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to clean occurrences: ${res.status}`);
    return res.json();
  }

  async searchGbif(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/occurrences/gbif/search`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to search GBIF: ${res.status}`);
    return res.json();
  }

  async parseDwca(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/occurrences/dwca`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to parse DwCA: ${res.status}`);
    return res.json();
  }

  async runModel(data: Record<string, unknown>): Promise<ModelRunResponse> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/run`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
      timeout: TIMEOUT_MODEL_RUN,
    });
    if (!res.ok) {
      let errorMsg = `Failed to run model: ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) errorMsg = body.error;
      } catch {
        // ignore parse error, use status code message
      }
      throw new Error(errorMsg);
    }
    return res.json();
  }

  async downloadClimate(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/climate/download`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
      timeout: TIMEOUT_CLIMATE,
    });
    if (!res.ok) throw new Error(`Failed to download climate: ${res.status}`);
    return res.json();
  }

  async getClimateStatus(climateJobId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/climate/status/${climateJobId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get climate status: ${res.status}`);
    return res.json();
  }

  async getClimateScenarios(): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/climate/scenarios`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get climate scenarios: ${res.status}`);
    return res.json();
  }

  async deleteClimateScenario(scenarioId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/climate/delete/${scenarioId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to delete climate scenario: ${res.status}`);
    return res.json();
  }

  async getJobStatus(jobId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/jobs/status/${jobId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get job status: ${res.status}`);
    return res.json();
  }

  async cancelJob(jobId: string): Promise<{ ok: boolean }> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/jobs/cancel/${jobId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to cancel job: ${res.status}`);
    return res.json();
  }

  async cancelModelRun(jobId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/cancel/${jobId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to cancel model run: ${res.status}`);
    return res.json();
  }

  async getModelStatus(jobId: string): Promise<ModelStatusResponse> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/status/${jobId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get model status: ${res.status}`);
    return res.json();
  }

  async deleteModelOutputs(jobId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/delete/${jobId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to delete model outputs: ${res.status}`);
    return res.json();
  }

  async getFutureScenarios(): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/future/scenarios`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get future scenarios: ${res.status}`);
    return res.json();
  }

  async generateEnsembleRasters(jobId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/ensemble-rasters/${jobId}`, {
      method: "POST",
      headers: this.headers(),
      timeout: TIMEOUT_NORMAL,
    });
    if (!res.ok) throw new Error(`Failed to generate ensemble rasters: ${res.status}`);
    return res.json();
  }

  async getEcologyData(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/ecology/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get ecology data: ${res.status}`);
    return res.json();
  }

  async getEooAoo(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/ecology/${runId}/eoo-aoo`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get EOO/AOO: ${res.status}`);
    return res.json();
  }

  async getAoa(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/ecology/${runId}/aoa`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get AOA: ${res.status}`);
    return res.json();
  }

  async getEcologyReport(runId: string): Promise<string> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/ecology/${runId}/report`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get ecology report: ${res.status}`);
    return res.text();
  }

  async getAsyncJobStatus(jobId: string): Promise<AsyncJobStatusResponse> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/jobs/status/${jobId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get job status: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsVif(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/vif/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get VIF diagnostics: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsAle(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/ale/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get ALE data: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsResponseCurves(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/response-curves/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get response curves: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsImportance(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/importance/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get variable importance: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsCbi(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/cbi/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get CBI diagnostics: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsMess(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/mess/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get MESS diagnostics: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsSummary(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/summary/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get diagnostics summary: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsRoc(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/roc/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get ROC data: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsCalibration(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/calibration/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get calibration data: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsCvFolds(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/cv-folds/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get CV folds data: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsThreshold(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/threshold/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get threshold data: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsDensity(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/density/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get density data: ${res.status}`);
    return res.json();
  }

  async generatePlots(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/plots/${runId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to generate plots: ${res.status}`);
    return res.json();
  }

  async getDiagnosticDataCsv(runId: string, type: string): Promise<Response> {
    return this._fetch(`${this.baseUrl}/api/v1/diagnostics/data/${runId}/${type}`, { headers: this.headers() });
  }

  async postDiagnosticsShapCell(runId: string, longitude: number, latitude: number): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/shap/cell`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ run_id: runId, longitude, latitude }),
    });
    if (!res.ok) throw new Error(`Failed to get SHAP cell explanation: ${res.status}`);
    return res.json();
  }
}

export const plumberClient = new PlumberClient();
