import type {
  PlumberUploadResponse,
  PlumberDiagnosticsShapCell,
  PlumberJobLogs,
} from "@sdm/shared";

const PLUMBER_URL = process.env.PLUMBER_URL || "http://localhost:8000";
const PLUMBER_INTERNAL_KEY = process.env.PLUMBER_INTERNAL_KEY || "";
const PLUMBER_MAX_CONCURRENT = parseInt(process.env.PLUMBER_MAX_CONCURRENT || "8", 10);
const PLUMBER_DEFAULT_TIMEOUT_MS = parseInt(process.env.PLUMBER_TIMEOUT_MS || "30000", 10);
const TIMEOUT_UPLOAD = parseInt(process.env.PLUMBER_UPLOAD_TIMEOUT_MS || "120000", 10);
const TIMEOUT_MODEL_RUN = parseInt(process.env.PLUMBER_MODEL_RUN_TIMEOUT_MS || "300000", 10);
const TIMEOUT_CLIMATE = parseInt(process.env.PLUMBER_CLIMATE_TIMEOUT_MS || "300000", 10);
const TIMEOUT_NORMAL = PLUMBER_DEFAULT_TIMEOUT_MS;

// Promise-based semaphore: resolves when a slot is available
let plumberQueue: Array<() => void> = [];
let plumberActiveRequests = 0;

async function plumberSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  if (plumberActiveRequests >= PLUMBER_MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const resolver: () => void = resolve;
      plumberQueue.push(resolver);
      const timeoutId = setTimeout(() => {
        const idx = plumberQueue.indexOf(resolver);
        if (idx >= 0) plumberQueue.splice(idx, 1);
        reject(new Error("Plumber semaphore timeout: all connections busy"));
      }, 5000);
      // Store timeoutId for cleanup when resolver is dequeued and called
      (resolver as any)._timeoutId = timeoutId;
    });
  }
  plumberActiveRequests++;
  try {
    return await fn();
  } finally {
    plumberActiveRequests--;
    if (plumberQueue.length > 0) {
      const next = plumberQueue.shift()!;
      const tid = (next as any)._timeoutId;
      if (tid) clearTimeout(tid);
      next();
    }
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (attempt < retries && RETRYABLE_STATUSES.has(res.status)) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("Request failed after retries");
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

  private async _fetch(url: string, options?: RequestInit, timeoutMs?: number): Promise<Response> {
    const ms = timeoutMs ?? PLUMBER_DEFAULT_TIMEOUT_MS;
    const opts = options ?? {};
    if (!opts.signal) {
      opts.signal = AbortSignal.timeout(ms);
    }
    return plumberSemaphore(() => fetchWithRetry(url, opts));
  }

  async healthCheck(): Promise<{ status: string; r_version: string; timestamp: string }> {
    const res = await this._fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`Plumber health check failed: ${res.status}`);
    return res.json();
  }

  async getConfigDefaults(): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/config/defaults`);
    if (!res.ok) throw new Error(`Failed to get config defaults: ${res.status}`);
    return res.json();
  }

  async getModels(): Promise<Array<{ id: string; label: string }>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models`);
    if (!res.ok) throw new Error(`Failed to get models: ${res.status}`);
    return res.json();
  }

  async uploadOccurrence(file: Buffer | string, filename?: string): Promise<PlumberUploadResponse> {
    const headers = this.headers();
    if (typeof file === "string") {
      const res = await this._fetch(`${this.baseUrl}/api/v1/occurrences/upload`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: file, file_id: filename }),
      }, TIMEOUT_UPLOAD);
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
    }, TIMEOUT_UPLOAD);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(body || `Failed to upload occurrence: ${res.status}`);
    }
    return res.json();
  }

  async cleanOccurrences(data: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async searchAla(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/occurrences/ala/search`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to search ALA: ${res.status}`);
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

  async runModel(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/run`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }, TIMEOUT_MODEL_RUN);
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
    }, TIMEOUT_CLIMATE);
    if (!res.ok) throw new Error(`Failed to download climate: ${res.status}`);
    return res.json();
  }

  async downloadCovariateBg(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/covariates/download_bg`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to start covariate download: ${res.status}`);
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

  async getModelStatus(jobId: string, timeoutMs: number = 10_000): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/status/${jobId}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Failed to get model status: ${res.status} ${body}`);
    }
    return res.json();
  }

  async cancelModel(jobId: string): Promise<{ ok: boolean; message: string }> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/cancel/${jobId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to cancel model run: ${res.status}`);
    return res.json();
  }

  async deleteModelOutputs(jobId: string): Promise<{ ok: boolean; message: string; deleted: boolean }> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/delete/${jobId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to delete model outputs: ${res.status}`);
    return res.json();
  }

  async getModelRuns(): Promise<Array<Record<string, unknown>>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/runs`);
    if (!res.ok) throw new Error(`Failed to get model runs: ${res.status}`);
    return res.json();
  }

  async getFutureScenarios(): Promise<{ available_scenarios: Array<Record<string, unknown>>; base_directory: string; message?: string }> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/future/scenarios`);
    if (!res.ok) throw new Error(`Failed to get future scenarios: ${res.status}`);
    return res.json();
  }

  async getClimateScenarios(): Promise<{ scenarios: Array<Record<string, unknown>> }> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/climate/scenarios`);
    if (!res.ok) throw new Error(`Failed to get climate scenarios: ${res.status}`);
    return res.json();
  }

  async deleteClimateScenario(scenarioId: string): Promise<{ ok: boolean; message: string }> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/climate/delete/${scenarioId}`, {
      method: "POST",
      headers: this.headers(),
    }, TIMEOUT_NORMAL);
    if (!res.ok) throw new Error(`Failed to delete scenario: ${res.status}`);
    return res.json();
  }

  async getUploads(limit?: number): Promise<{ uploads: Array<Record<string, unknown>> }> {
    const params = limit ? `?limit=${limit}` : "";
    const res = await this._fetch(`${this.baseUrl}/api/v1/occurrences/uploads${params}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to list uploads: ${res.status}`);
    return res.json();
  }

  async getClimateStatus(jobId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/climate/status/${jobId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get climate status: ${res.status}`);
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

  async postNicheOverlap(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/ecology/niche-overlap`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as Record<string, unknown>).error as string || `Niche overlap failed: ${res.status}`);
    }
    return res.json();
  }

  async getEcologyReport(runId: string): Promise<string> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/ecology/${runId}/report`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get ecology report: ${res.status}`);
    return res.text();
  }

  async getDiagnosticsVif(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/vif/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get VIF diagnostics: ${res.status}`);
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

  async getDiagnosticsAle(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/ale/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get ALE data: ${res.status}`);
    return res.json();
  }

  async getDiagnosticsClimateDrivers(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/climate-drivers/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get climate driver data: ${res.status}`);
    return res.json();
  }

  async generateEnsembleRasters(runId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/ensemble-rasters/${runId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to generate ensemble rasters: ${res.status}`);
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

  async postDiagnosticsShapCell(runId: string, longitude: number, latitude: number): Promise<PlumberDiagnosticsShapCell> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/diagnostics/shap/cell`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ run_id: runId, longitude, latitude }),
    });
    if (!res.ok) throw new Error(`Failed to get SHAP cell explanation: ${res.status}`);
    return res.json();
  }

  async getRunComparison(runId1: string, runId2: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/compare/${runId1}/${runId2}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to compare runs: ${res.status}`);
    return res.json();
  }

  async get(path: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  }

  async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  }

  async postRaw(path: string, body: unknown): Promise<[number, Record<string, unknown>]> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as Record<string, unknown>;
    return [res.status, data];
  }

  async postForm(path: string, formData: FormData): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: formData,
    });
    if (!res.ok) throw new Error(`POST ${path} (form) failed: ${res.status}`);
    return res.json();
  }

  // ── Targets pipeline ───────────────────────────────────────────────────

  async targetsRun(data: { configs: Record<string, unknown>[] }): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/targets-run`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }, TIMEOUT_MODEL_RUN);
    if (!res.ok) throw new Error(`Failed to start targets run: ${res.status}`);
    return res.json();
  }

  async targetsStatus(jobId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/targets-status/${jobId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to get targets status: ${res.status}`);
    return res.json();
  }

  async targetsResults(jobId: string): Promise<Record<string, unknown>> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/targets-results/${jobId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to get targets results: ${res.status}`);
    return res.json();
  }

  async getModelLogs(jobId: string): Promise<PlumberJobLogs> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/models/logs/${jobId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to get model logs: ${res.status}`);
    return res.json();
  }
}

export const plumberClient = new PlumberClient();
