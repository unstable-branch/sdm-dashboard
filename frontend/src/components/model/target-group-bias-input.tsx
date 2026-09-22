interface TargetGroupBiasInputProps {
  file: File | null;
  onChange: (file: File | null) => void;
}

export function TargetGroupBiasInput({ file, onChange }: TargetGroupBiasInputProps) {
  return (
    <div className="mt-2">
      <label htmlFor="target-group-file" className="block text-xs font-medium text-sdm-muted mb-1">
        Target-group occurrence file
      </label>
      <input
        id="target-group-file"
        type="file"
        accept=".csv,.tsv,.txt"
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text file:mr-3 file:rounded file:border-0 file:bg-sdm-accent file:px-2 file:py-1 file:text-xs file:text-white"
      />
      <p className="mt-1 text-xs text-sdm-muted">
        {file ? file.name : "Upload background occurrences. The server stores and resolves them by opaque asset ID."}
      </p>
    </div>
  );
}
