interface SourceCountsProps {
  counts: Record<string, number>;
  total?: number;
}

export function SourceCounts({ counts, total }: SourceCountsProps) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const totalCount = total || entries.reduce((sum, [, count]) => sum + count, 0);

  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
      <h3 className="text-sm font-semibold text-sdm-heading mb-3">
        Source breakdown ({totalCount} records)
      </h3>
      <div className="space-y-2">
        {entries.map(([source, count]) => {
          const pct = totalCount > 0 ? (count / totalCount) * 100 : 0;
          return (
            <div key={source}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-sdm-text font-medium truncate mr-2">{source}</span>
                <span className="text-sdm-muted tabular-nums">
                  {count.toLocaleString()} ({pct.toFixed(1)}%)
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-sdm-surface-soft overflow-hidden">
                <div
                  className="h-full rounded-full bg-sdm-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
