import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string;
  description?: string;
  className?: string;
}

export function MetricCard({ title, value, description, className }: MetricCardProps) {
  return (
    <div className={cn(
      "rounded-lg border border-sdm-border bg-sdm-surface p-4 shadow-sm",
      "border-l-4 border-l-sdm-accent",
      className
    )}>
      <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">
        {title}
      </p>
      <p className="mt-1 text-2xl font-bold text-sdm-heading">{value}</p>
      {description && (
        <p className="mt-1 text-sm text-sdm-muted">{description}</p>
      )}
    </div>
  );
}
