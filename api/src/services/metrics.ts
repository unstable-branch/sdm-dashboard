import * as prom from "prom-client";
import { plumberClient } from "./plumber.js";

let _registry: prom.Registry | null = null;

// API-level metrics
let httpRequestsTotal: prom.Counter<string>;
let httpRequestDuration: prom.Histogram<string>;
let activeApiRequests: prom.Gauge<string>;
let activeQueueDepth: prom.Gauge<string>;

// GPU metrics (collected from Plumber health endpoint)
let gpuFreeVramMiB: prom.Gauge<string>;
let gpuTotalVramMiB: prom.Gauge<string>;
let gpuUsedVramMiB: prom.Gauge<string>;
let gpuUtilizationPct: prom.Gauge<string>;
let gpuTemperatureC: prom.Gauge<string>;
let gpuCanaryOk: prom.Gauge<string>;
let gpuCanaryElapsedMs: prom.Gauge<string>;
let gpuVramLeakFlag: prom.Gauge<string>;
let gpuRMemoryGb: prom.Gauge<string>;
let gpuModelRunsActive: prom.Gauge<string>;

function ensureRegistry(): prom.Registry {
  if (_registry) return _registry;
  _registry = new prom.Registry();
  prom.collectDefaultMetrics({ register: _registry });

  httpRequestsTotal = new prom.Counter({
    name: "sdm_http_requests_total",
    help: "Total HTTP requests processed",
    labelNames: ["method", "route", "status"],
    registers: [_registry],
  });

  httpRequestDuration = new prom.Histogram({
    name: "sdm_http_request_duration_ms",
    help: "HTTP request duration in milliseconds",
    labelNames: ["method", "route", "status"],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [_registry],
  });

  activeApiRequests = new prom.Gauge({
    name: "sdm_active_api_requests",
    help: "Currently active API requests",
    registers: [_registry],
  });

  activeQueueDepth = new prom.Gauge({
    name: "sdm_queue_depth",
    help: "Current BullMQ job queue depth",
    registers: [_registry],
  });

  gpuFreeVramMiB = new prom.Gauge({
    name: "sdm_gpu_free_vram_mib",
    help: "Free GPU VRAM in MiB",
    registers: [_registry],
  });

  gpuTotalVramMiB = new prom.Gauge({
    name: "sdm_gpu_total_vram_mib",
    help: "Total GPU VRAM in MiB",
    registers: [_registry],
  });

  gpuUsedVramMiB = new prom.Gauge({
    name: "sdm_gpu_used_vram_mib",
    help: "Used GPU VRAM in MiB",
    registers: [_registry],
  });

  gpuUtilizationPct = new prom.Gauge({
    name: "sdm_gpu_utilization_pct",
    help: "GPU utilization percentage",
    registers: [_registry],
  });

  gpuTemperatureC = new prom.Gauge({
    name: "sdm_gpu_temperature_c",
    help: "GPU temperature in Celsius",
    registers: [_registry],
  });

  gpuCanaryOk = new prom.Gauge({
    name: "sdm_gpu_canary_ok",
    help: "GPU canary health (1 = ok, 0 = failing)",
    registers: [_registry],
  });

  gpuCanaryElapsedMs = new prom.Gauge({
    name: "sdm_gpu_canary_elapsed_ms",
    help: "GPU canary inference time in milliseconds",
    registers: [_registry],
  });

  gpuVramLeakFlag = new prom.Gauge({
    name: "sdm_gpu_vram_leak",
    help: "GPU VRAM leak detection (1 = leak suspected)",
    registers: [_registry],
  });

  gpuRMemoryGb = new prom.Gauge({
    name: "sdm_plumber_memory_gb",
    help: "Plumber R process memory in GB",
    registers: [_registry],
  });

  gpuModelRunsActive = new prom.Gauge({
    name: "sdm_active_gpu_runs",
    help: "Active GPU model runs",
    registers: [_registry],
  });

  return _registry;
}

export function getRegistry(): prom.Registry | null {
  return _registry;
}

export function recordHttpRequest(method: string, route: string, status: number, durationMs: number): void {
  if (!_registry) return;
  httpRequestsTotal.labels(method, route, String(status)).inc();
  httpRequestDuration.labels(method, route, String(status)).observe(durationMs);
}

export function setActiveRequests(n: number): void {
  if (!_registry) return;
  activeApiRequests.set(n);
}

export function setQueueDepth(n: number): void {
  if (!_registry) return;
  activeQueueDepth.set(n);
}

export async function collectGpuMetrics(): Promise<void> {
  if (!_registry) return;
  try {
    const status = await plumberClient.getGpuStatus() as Record<string, unknown>;
    const freeVram = status.vram_free_mib;
    if (typeof freeVram === "number" && isFinite(freeVram)) {
      gpuFreeVramMiB.set(freeVram);
    }
    const totalVram = status.vram_total_mib;
    if (typeof totalVram === "number" && isFinite(totalVram)) {
      gpuTotalVramMiB.set(totalVram);
    }
    const usedVram = status.vram_used_mib;
    if (typeof usedVram === "number" && isFinite(usedVram)) {
      gpuUsedVramMiB.set(usedVram);
    }
    const utilPct = status.gpu_utilization_pct;
    if (typeof utilPct === "number" && isFinite(utilPct)) {
      gpuUtilizationPct.set(utilPct);
    }
    const tempC = status.temperature_c;
    if (typeof tempC === "number" && isFinite(tempC)) {
      gpuTemperatureC.set(tempC);
    }
    const canary = status.canary as Record<string, unknown> | undefined;
    if (canary) {
      gpuCanaryOk.set(canary.ok === true ? 1 : 0);
      if (typeof canary.elapsed_ms === "number" && isFinite(canary.elapsed_ms)) {
        gpuCanaryElapsedMs.set(canary.elapsed_ms);
      }
    } else {
      gpuCanaryOk.set(0);
    }
    const leak = status.leak_check as Record<string, unknown> | undefined;
    if (leak) {
      gpuVramLeakFlag.set(leak.leak === true ? 1 : 0);
    } else {
      gpuVramLeakFlag.set(0);
    }
    const rMemory = status.r_memory_gb;
    if (typeof rMemory === "number" && isFinite(rMemory)) {
      gpuRMemoryGb.set(rMemory);
    }
    const activeRuns = status.active_gpu_runs;
    if (typeof activeRuns === "number" && isFinite(activeRuns)) {
      gpuModelRunsActive.set(activeRuns);
    }
  } catch {
    // GPU metrics collection is best-effort
  }
}

export function initMetrics(): void {
  ensureRegistry();
}

export async function metricsHandler(): Promise<string> {
  if (!_registry) return "# no metrics";
  return _registry.metrics();
}
