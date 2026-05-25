type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type BatchComparisonRun = {
  id: string;
  species: string | null;
  model_id: string | null;
  status: RunStatus;
  metrics?: unknown;
  error?: string | null;
};

type MetricSummary = {
  count: number;
  min: number;
  max: number;
  mean: number;
};

type MetricGroup = {
  key: string | null;
  runs: number;
  with_metrics: number;
  metrics: Record<string, MetricSummary>;
};

type ComparisonWarning = {
  code: "failed_run" | "cancelled_run" | "incomplete_run" | "missing_metrics" | "non_numeric_metrics";
  severity: "warning";
  message: string;
  run_id: string;
  species: string | null;
  model_id: string | null;
};

export type BatchComparisonSummary = {
  schema: "batch_comparison.v1";
  counts: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    with_metrics: number;
    missing_metrics: number;
  };
  metrics: {
    by_run: Array<{
      run_id: string;
      species: string | null;
      model_id: string | null;
      status: RunStatus;
      metrics: Record<string, number>;
    }>;
    by_species: MetricGroup[];
    by_model: MetricGroup[];
  };
  warnings: ComparisonWarning[];
};

const MAX_METRIC_KEYS = 40;
const MAX_METRIC_KEY_LENGTH = 80;

export function buildBatchComparisonSummary(runs: BatchComparisonRun[]): BatchComparisonSummary {
  const counts = {
    total: runs.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    with_metrics: 0,
    missing_metrics: 0,
  };

  const byRun: BatchComparisonSummary["metrics"]["by_run"] = [];
  const groupRows: Array<{
    run_id: string;
    species: string | null;
    model_id: string | null;
    metrics: Record<string, number>;
  }> = [];
  const warnings: ComparisonWarning[] = [];

  for (const run of runs) {
    counts[run.status]++;
    const metrics = extractNumericMetrics(run.metrics);
    const hasMetricsPayload = isRecord(run.metrics) && Object.keys(run.metrics).length > 0;

    if (Object.keys(metrics).length > 0) {
      counts.with_metrics++;
      byRun.push({
        run_id: run.id,
        species: run.species,
        model_id: run.model_id,
        status: run.status,
        metrics,
      });
    } else {
      counts.missing_metrics++;
    }
    groupRows.push({
      run_id: run.id,
      species: run.species,
      model_id: run.model_id,
      metrics,
    });

    if (run.status === "failed") {
      warnings.push(warningFor(run, "failed_run", run.error ? `Run failed: ${run.error}` : "Run failed."));
    } else if (run.status === "cancelled") {
      warnings.push(warningFor(run, "cancelled_run", "Run was cancelled before producing comparable metrics."));
    } else if (run.status === "queued" || run.status === "running") {
      warnings.push(warningFor(run, "incomplete_run", "Run is not terminal yet, so comparison metrics may be incomplete."));
    } else if (Object.keys(metrics).length === 0) {
      warnings.push(warningFor(run, hasMetricsPayload ? "non_numeric_metrics" : "missing_metrics", "Completed run has no numeric comparison metrics."));
    }
  }

  return {
    schema: "batch_comparison.v1",
    counts,
    metrics: {
      by_run: byRun,
      by_species: summarizeMetricGroups(groupRows, "species"),
      by_model: summarizeMetricGroups(groupRows, "model_id"),
    },
    warnings,
  };
}

function warningFor(run: BatchComparisonRun, code: ComparisonWarning["code"], message: string): ComparisonWarning {
  return {
    code,
    severity: "warning",
    message,
    run_id: run.id,
    species: run.species,
    model_id: run.model_id,
  };
}

function extractNumericMetrics(metrics: unknown): Record<string, number> {
  if (!isRecord(metrics)) {
    return {};
  }

  const result: Record<string, number> = {};
  collectNumericMetrics(metrics, "", result);
  return result;
}

function collectNumericMetrics(value: unknown, prefix: string, result: Record<string, number>): void {
  if (Object.keys(result).length >= MAX_METRIC_KEYS || !isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_METRIC_KEYS) {
      return;
    }

    const normalizedKey = normalizeMetricKey(prefix ? `${prefix}.${key}` : key);
    if (!normalizedKey) {
      continue;
    }

    if (typeof child === "number" && Number.isFinite(child)) {
      result[normalizedKey] = child;
    } else if (isRecord(child) && prefix === "") {
      collectNumericMetrics(child, normalizedKey, result);
    }
  }
}

function normalizeMetricKey(key: string): string | null {
  const normalized = key.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, MAX_METRIC_KEY_LENGTH);
  return normalized.length > 0 ? normalized : null;
}

function summarizeMetricGroups(
  rows: Array<{
    run_id: string;
    species: string | null;
    model_id: string | null;
    metrics: Record<string, number>;
  }>,
  groupKey: "species" | "model_id",
): MetricGroup[] {
  const groups = new Map<string, {
    key: string | null;
    runs: Set<string>;
    withMetrics: Set<string>;
    values: Map<string, number[]>;
  }>();

  for (const row of rows) {
    const rawKey = row[groupKey];
    const mapKey = rawKey ?? "__unknown__";
    let group = groups.get(mapKey);
    if (!group) {
      group = { key: rawKey, runs: new Set(), withMetrics: new Set(), values: new Map() };
      groups.set(mapKey, group);
    }

    group.runs.add(row.run_id);
    if (Object.keys(row.metrics).length > 0) {
      group.withMetrics.add(row.run_id);
    }
    for (const [metricKey, value] of Object.entries(row.metrics)) {
      const values = group.values.get(metricKey) ?? [];
      values.push(value);
      group.values.set(metricKey, values);
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      key: group.key,
      runs: group.runs.size,
      with_metrics: group.withMetrics.size,
      metrics: Object.fromEntries(
        Array.from(group.values.entries()).map(([metricKey, values]) => [metricKey, summarizeValues(values)]),
      ),
    }))
    .sort((a, b) => String(a.key ?? "").localeCompare(String(b.key ?? "")));
}

function summarizeValues(values: number[]): MetricSummary {
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: sum / values.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
