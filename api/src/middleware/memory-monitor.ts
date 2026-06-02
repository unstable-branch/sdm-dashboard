const WARN_THRESHOLD_MB = 500;
const CRITICAL_THRESHOLD_MB = 1000;
const CHECK_INTERVAL_MS = 30_000;

let _monitorInterval: ReturnType<typeof setInterval> | null = null;
let _lastWarnTime = 0;

function getMemoryUsageMB(): number {
  const mem = process.memoryUsage();
  return Math.round(mem.heapUsed / 1024 / 1024);
}

function getMemorySnapshot() {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    externalMB: Math.round(mem.external / 1024 / 1024),
  };
}

function checkMemory() {
  const heapUsedMB = getMemoryUsageMB();
  const now = Date.now();

  if (heapUsedMB >= CRITICAL_THRESHOLD_MB) {
    console.error(`[MemoryMonitor] CRITICAL: Heap usage ${heapUsedMB}MB exceeds ${CRITICAL_THRESHOLD_MB}MB threshold`);
    console.error(`[MemoryMonitor] Snapshot: ${JSON.stringify(getMemorySnapshot())}`);
    _lastWarnTime = now;
  } else if (heapUsedMB >= WARN_THRESHOLD_MB && now - _lastWarnTime > 60_000) {
    console.warn(`[MemoryMonitor] WARNING: Heap usage ${heapUsedMB}MB exceeds ${WARN_THRESHOLD_MB}MB threshold`);
    console.warn(`[MemoryMonitor] Snapshot: ${JSON.stringify(getMemorySnapshot())}`);
    _lastWarnTime = now;
  }
}

export function startMemoryMonitor(intervalMs = CHECK_INTERVAL_MS) {
  if (_monitorInterval) return;
  console.log(`[MemoryMonitor] Starting — checking every ${intervalMs}ms (warn: ${WARN_THRESHOLD_MB}MB, critical: ${CRITICAL_THRESHOLD_MB}MB)`);
  _monitorInterval = setInterval(checkMemory, intervalMs);
  _monitorInterval.unref();
}

export function stopMemoryMonitor() {
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
    console.log("[MemoryMonitor] Stopped");
  }
}

export function getMemoryStatus() {
  return {
    ...getMemorySnapshot(),
    timestamp: new Date().toISOString(),
  };
}


