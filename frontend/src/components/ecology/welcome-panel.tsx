export function WelcomePanel() {
  const steps = [
    { num: 1, title: "Upload occurrence data", desc: "CSV, TSV, or fetch from GBIF" },
    { num: 2, title: "Configure model", desc: "Select algorithm and covariates" },
    { num: 3, title: "Run and evaluate", desc: "View suitability maps and diagnostics" },
  ];

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
      <h3 className="text-lg font-semibold text-sdm-heading mb-4">Getting Started</h3>
      <div className="space-y-4">
        {steps.map((step) => (
          <div key={step.num} className="flex gap-3 items-start">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sdm-accent text-white text-sm font-bold">
              {step.num}
            </div>
            <div>
              <h4 className="text-sm font-medium text-sdm-text">{step.title}</h4>
              <p className="text-xs text-sdm-muted">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-md border border-sdm-accent-blue/20 bg-sdm-accent-blue/5 p-3 text-sm text-sdm-accent-blue">
        Tip: Use the synthetic demo dataset to explore the platform without your own data.
      </div>
    </div>
  );
}
