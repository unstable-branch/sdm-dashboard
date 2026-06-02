"use client";



interface ModelParamPanelProps {
  modelId: string;
  maxnetFeatures: string;
  maxnetRegmult: number;
  maxnetAutoTune: boolean;
  dnnArchitecture: string;
  dnnNSeeds: number;
  dnnDevice: string;
  dnnDropout: number;
  dnnL2Lambda: number;
  gamK: number;
  brtNTrees: number;
  brtInteractionDepth: number;
  brtShrinkage: number;
  brtBagFraction: number;
  ctaCp: number;
  ctaMaxdepth: number;
  ctaMinsplit: number;
  annSize: number;
  annDecay: number;
  annMaxit: number;
  annRang: number;
  marsDegree: number;
  marsPenalty: number;
  marsNk: number | undefined;
  fdaNprune: number | undefined;
  rfNumTrees: number;
  rfMtry: number | undefined;
  rfMinNodeSize: number;
  xgbMaxDepth: number;
  xgbEta: number;
  xgbNrounds: number;
  bartNtree: number;
  bartNdpost: number;
  bartNskip: number;
  brmsChains: number;
  brmsIter: number;
  brmsWarmup: number;
  inlaMeshMaxEdge: number | undefined;
  inlaMeshCutoff: number | undefined;
  rangebagNBags: number;
  rangebagBagFraction: number;
  rangebagVarsPerBag: number;
  detectionFormula: string;
  detectionModelType: "occu" | "occuRN";
  dnnMultispeciesArchitecture: string;
  dnnMultispeciesNSeeds: number;
  biomod2Models: string[];
  multiEnsembleModels: string[];
  multiEnsembleBiomod2: string[];
  multiEnsembleWeighting: string;
  multiEnsemblePower: number;
  multiEnsembleMinAuc: number;
  multiEnsembleMinTss: number;
  fdaDegree: number;
  onSet: (key: string, value: unknown) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-sdm-text mb-1">{label}</label>
      {children}
    </div>
  );
}

function SliderField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <Field label={label}>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} min={min} max={max} step={step} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
    </Field>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function ModelParamPanel({ modelId, ...p }: ModelParamPanelProps) {
  const s = (key: string) => (v: unknown) => p.onSet(key, v);

  if (modelId === "maxnet") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SelectField label="MaxEnt features" value={p.maxnetFeatures} onChange={s("maxnetFeatures")}
          options={[{ value: "l", label: "Linear" }, { value: "lq", label: "Linear + Quadratic" }, { value: "lqp", label: "Linear + Quadratic + Product" }, { value: "lqh", label: "Linear + Quadratic + Hinge" }, { value: "lqpht", label: "All" }]} />
        <SliderField label="Regularization multiplier" value={p.maxnetRegmult} onChange={s("maxnetRegmult")} min={0.1} max={10} step={0.1} />
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={p.maxnetAutoTune} onChange={() => s("maxnetAutoTune")(!p.maxnetAutoTune)} />
          Auto-tune regmult + features
        </label>
      </div>
    );
  }

  if (modelId === "dnn") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SelectField label="DNN architecture" value={p.dnnArchitecture} onChange={s("dnnArchitecture")}
          options={[{ value: "DNN_Small", label: "Small (1×64)" }, { value: "DNN_Medium", label: "Medium (2×100)" }, { value: "DNN_Large", label: "Large (3×100)" }]} />
        <SliderField label="Ensemble seeds (uncertainty)" value={p.dnnNSeeds} onChange={s("dnnNSeeds")} min={1} max={20} step={1} />
        <SelectField label="Device" value={p.dnnDevice} onChange={s("dnnDevice")}
          options={[{ value: "auto", label: "Auto-detect" }, { value: "cpu", label: "CPU only" }, { value: "gpu", label: "GPU if available" }]} />
        <SliderField label="Dropout" value={p.dnnDropout} onChange={s("dnnDropout")} min={0} max={0.5} step={0.05} />
        <SliderField label="L2 lambda" value={p.dnnL2Lambda} onChange={s("dnnL2Lambda")} min={0.0001} max={0.1} step={0.0001} />
        <p className="-mt-2 text-xs text-sdm-muted">Multiple seeds with different initialisations; prediction SD measures uncertainty</p>
      </div>
    );
  }

  if (modelId === "gam") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SliderField label="Basis dimension (k)" value={p.gamK} onChange={s("gamK")} min={3} max={15} step={1} />
        <p className="-mt-2 text-xs text-sdm-muted">Higher k = more flexible = more overfitting risk. Start at 5.</p>
      </div>
    );
  }

  if (modelId === "brt") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SliderField label="Number of trees" value={p.brtNTrees} onChange={s("brtNTrees")} min={100} max={10000} step={100} />
        <SliderField label="Interaction depth" value={p.brtInteractionDepth} onChange={s("brtInteractionDepth")} min={1} max={10} step={1} />
        <SliderField label="Learning rate (shrinkage)" value={p.brtShrinkage} onChange={s("brtShrinkage")} min={0.001} max={0.5} step={0.001} />
        <SliderField label="Bag fraction" value={p.brtBagFraction} onChange={s("brtBagFraction")} min={0.1} max={1} step={0.05} />
      </div>
    );
  }

  if (modelId === "cta") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SliderField label="Complexity parameter (cp)" value={p.ctaCp} onChange={s("ctaCp")} min={0.001} max={0.5} step={0.001} />
        <SliderField label="Max tree depth" value={p.ctaMaxdepth} onChange={s("ctaMaxdepth")} min={3} max={30} step={1} />
        <SliderField label="Min split size" value={p.ctaMinsplit} onChange={s("ctaMinsplit")} min={2} max={100} step={1} />
      </div>
    );
  }

  if (modelId === "ann") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SliderField label="Hidden layer size" value={p.annSize} onChange={s("annSize")} min={2} max={50} step={1} />
        <SliderField label="Weight decay" value={p.annDecay} onChange={s("annDecay")} min={0.0001} max={1} step={0.001} />
        <SliderField label="Max iterations" value={p.annMaxit} onChange={s("annMaxit")} min={50} max={1000} step={50} />
        <SliderField label="Initial weight range (rang)" value={p.annRang} onChange={s("annRang")} min={0.01} max={10} step={0.1} />
      </div>
    );
  }

  if (modelId === "mars") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SliderField label="Max interaction degree" value={p.marsDegree} onChange={s("marsDegree")} min={1} max={5} step={1} />
        <SliderField label="Penalty per knot" value={p.marsPenalty} onChange={s("marsPenalty")} min={0} max={10} step={0.5} />
        <Field label="Max number of terms (nk)">
          <input type="number" value={p.marsNk ?? ""} onChange={(e) => s("marsNk")(e.target.value ? Number(e.target.value) : undefined)} min={1} max={100} step={1} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
          <p className="mt-1 text-xs text-sdm-muted">Leave empty for automatic selection</p>
        </Field>
      </div>
    );
  }

  if (modelId === "fda") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SelectField label="MARS degree" value={String(p.fdaDegree)} onChange={(v) => s("fdaDegree")(Number(v))}
          options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }, { value: "5", label: "5" }]} />
        <Field label="MARS term pruning (nprune)">
          <input type="number" value={p.fdaNprune ?? ""} onChange={(e) => s("fdaNprune")(e.target.value ? Number(e.target.value) : undefined)} min={1} max={100} step={1} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
          <p className="mt-1 text-xs text-sdm-muted">Leave empty for no pruning</p>
        </Field>
      </div>
    );
  }

  if (modelId === "rf") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Requires the ranger package to be installed.</p>
        <SliderField label="Number of trees" value={p.rfNumTrees} onChange={s("rfNumTrees")} min={10} max={10000} step={100} />
        <Field label="Mtry (variables per split)">
          <input type="number" value={p.rfMtry ?? ""} onChange={(e) => s("rfMtry")(e.target.value ? Number(e.target.value) : undefined)} min={1} max={100} step={1} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
          <p className="mt-1 text-xs text-sdm-muted">Leave empty for auto (sqrt of variables)</p>
        </Field>
        <SliderField label="Min node size" value={p.rfMinNodeSize} onChange={s("rfMinNodeSize")} min={1} max={100} step={1} />
      </div>
    );
  }

  if (modelId === "xgboost") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Requires the xgboost package to be installed.</p>
        <SliderField label="Max tree depth" value={p.xgbMaxDepth} onChange={s("xgbMaxDepth")} min={1} max={20} step={1} />
        <SliderField label="Learning rate (eta)" value={p.xgbEta} onChange={s("xgbEta")} min={0.001} max={1} step={0.01} />
        <SliderField label="Number of rounds" value={p.xgbNrounds} onChange={s("xgbNrounds")} min={10} max={10000} step={100} />
      </div>
    );
  }

  if (modelId === "bart") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Requires the dbarts package to be installed.</p>
        <SliderField label="Number of trees" value={p.bartNtree} onChange={s("bartNtree")} min={10} max={10000} step={50} />
        <SliderField label="Posterior draws" value={p.bartNdpost} onChange={s("bartNdpost")} min={100} max={10000} step={100} />
        <SliderField label="Burn-in (skip)" value={p.bartNskip} onChange={s("bartNskip")} min={50} max={5000} step={50} />
      </div>
    );
  }

  if (modelId === "brms") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Requires brms and cmdstanr packages. First fit compiles Stan code (5-15 min).</p>
        <SliderField label="Chains" value={p.brmsChains} onChange={s("brmsChains")} min={1} max={8} step={1} />
        <SliderField label="Total iterations" value={p.brmsIter} onChange={s("brmsIter")} min={500} max={10000} step={500} />
        <SliderField label="Warmup" value={p.brmsWarmup} onChange={s("brmsWarmup")} min={100} max={5000} step={100} />
      </div>
    );
  }

  if (modelId === "inla_spde") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Requires INLA package from r-inla-download.org.</p>
        <Field label="Mesh max edge">
          <input type="number" value={p.inlaMeshMaxEdge ?? ""} onChange={(e) => s("inlaMeshMaxEdge")(e.target.value ? Number(e.target.value) : undefined)} min={0.01} max={100} step={0.5} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
          <p className="mt-1 text-xs text-sdm-muted">Max triangle edge length. Leave empty for auto.</p>
        </Field>
        <Field label="Mesh cutoff">
          <input type="number" value={p.inlaMeshCutoff ?? ""} onChange={(e) => s("inlaMeshCutoff")(e.target.value ? Number(e.target.value) : undefined)} min={0.001} max={10} step={0.1} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
        </Field>
      </div>
    );
  }

  if (modelId === "rangebag") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <SliderField label="Number of bags" value={p.rangebagNBags} onChange={s("rangebagNBags")} min={10} max={1000} step={10} />
        <SliderField label="Bag fraction" value={p.rangebagBagFraction} onChange={s("rangebagBagFraction")} min={0.1} max={1} step={0.05} />
        <SliderField label="Variables per bag" value={p.rangebagVarsPerBag} onChange={s("rangebagVarsPerBag")} min={1} max={10} step={1} />
      </div>
    );
  }

  if (modelId === "occupancy") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Requires detection-history data with repeated surveys.</p>
        <SelectField label="Model type" value={p.detectionModelType} onChange={(v) => s("detectionModelType")(v)}
          options={[{ value: "occu", label: "Single-season occupancy (occu)" }, { value: "occuRN", label: "Royle-Nichols (occuRN)" }]} />
        <Field label="Detection formula">
          <input type="text" value={p.detectionFormula} onChange={(e) => s("detectionFormula")(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text font-mono" />
          <p className="mt-1 text-xs text-sdm-muted">R formula for detection covariates (e.g., ~1 for constant)</p>
        </Field>
      </div>
    );
  }

  if (modelId === "dnn_multispecies") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Requires cito and torch packages.</p>
        <SelectField label="DNN architecture" value={p.dnnMultispeciesArchitecture} onChange={s("dnnMultispeciesArchitecture")}
          options={[{ value: "DNN_Small", label: "Small (1×64)" }, { value: "DNN_Medium", label: "Medium (2×100)" }, { value: "DNN_Large", label: "Large (3×100)" }]} />
        <SliderField label="Ensemble seeds" value={p.dnnMultispeciesNSeeds} onChange={s("dnnMultispeciesNSeeds")} min={1} max={10} step={1} />
      </div>
    );
  }

  if (modelId === "ensemble_glm_rangebag") {
    return (
      <div className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft px-4 py-3">
        <p className="text-xs text-sdm-muted">AUC-weighted ensemble combining GLM and Rangebagging predictions. No additional parameters needed.</p>
      </div>
    );
  }

  if (modelId === "multi_ensemble") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Select at least 2 models. biomod2 requires options(sdm.enable_biomod2 = TRUE).</p>
        <Field label="Standalone models">
          <div className="space-y-1">
            {[{ id: "glm", label: "GLM" }, { id: "gam", label: "GAM" }, { id: "maxnet", label: "MaxEnt" }, { id: "rf", label: "Random Forest" }, { id: "xgboost", label: "XGBoost" }, { id: "rangebag", label: "Rangebagging" }].map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-xs text-sdm-text">
                <input type="checkbox" checked={p.multiEnsembleModels.includes(m.id)} onChange={() => s("multiEnsembleModels")(p.multiEnsembleModels.includes(m.id) ? p.multiEnsembleModels.filter((x: string) => x !== m.id) : [...p.multiEnsembleModels, m.id])} className="rounded" />
                {m.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="biomod2 algorithms">
          <div className="space-y-1">
            {[{ id: "GAM", label: "GAM" }, { id: "FDA", label: "FDA" }, { id: "MARS", label: "MARS" }, { id: "RF", label: "RF" }, { id: "GBM", label: "GBM" }, { id: "BRT", label: "BRT" }, { id: "MAXNET", label: "MAXNET" }, { id: "SRE", label: "SRE" }, { id: "CTA", label: "CTA" }, { id: "XGBOOST", label: "XGBOOST" }].map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-xs text-sdm-text ml-4">
                <input type="checkbox" checked={p.multiEnsembleBiomod2.includes(a.id)} onChange={() => s("multiEnsembleBiomod2")(p.multiEnsembleBiomod2.includes(a.id) ? p.multiEnsembleBiomod2.filter((x: string) => x !== a.id) : [...p.multiEnsembleBiomod2, a.id])} className="rounded" />
                {a.label}
              </label>
            ))}
          </div>
        </Field>
        <SelectField label="Weighting" value={p.multiEnsembleWeighting} onChange={s("multiEnsembleWeighting")}
          options={[{ value: "equal", label: "Equal average" }, { value: "auc", label: "AUC-weighted" }, { value: "tss", label: "TSS-weighted" }]} />
        <SliderField label="Weight power" value={p.multiEnsemblePower} onChange={s("multiEnsemblePower")} min={1} max={5} step={0.5} />
        <div className="grid grid-cols-2 gap-3">
          <SliderField label="Min AUC" value={p.multiEnsembleMinAuc} onChange={s("multiEnsembleMinAuc")} min={0.5} max={1} step={0.05} />
          <SliderField label="Min TSS" value={p.multiEnsembleMinTss} onChange={s("multiEnsembleMinTss")} min={0} max={1} step={0.05} />
        </div>
      </div>
    );
  }

  if (modelId === "biomod2") {
    return (
      <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
        <p className="text-xs text-sdm-warning mb-2">Requires biomod2 package + options(sdm.enable_biomod2 = TRUE) in R.</p>
        <Field label="biomod2 algorithms">
          <div className="space-y-1">
            {[{ id: "GLM", label: "GLM" }, { id: "GAM", label: "GAM" }, { id: "MAXNET", label: "MaxEnt (MAXNET)" }, { id: "RF", label: "Random Forest" }].map((algo) => (
              <label key={algo.id} className="flex items-center gap-2 text-xs text-sdm-text">
                <input type="checkbox" checked={p.biomod2Models.includes(algo.id)} onChange={() => s("biomod2Models")(p.biomod2Models.includes(algo.id) ? p.biomod2Models.filter((x: string) => x !== algo.id) : [...p.biomod2Models, algo.id])} className="rounded" />
                {algo.label}
              </label>
            ))}
          </div>
        </Field>
      </div>
    );
  }

  if (modelId === "python_elapid" || modelId === "python_sklearn_rf") {
    return (
      <div className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft px-4 py-3">
        <p className="text-xs text-sdm-muted">Python model bridge. Requires Python + required pip packages.</p>
      </div>
    );
  }

  if (modelId === "bioclim") {
    return (
      <div className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft px-4 py-3">
        <p className="text-xs text-sdm-muted">BIOCLIM is a presence-only environmental envelope model. No additional parameters needed.</p>
      </div>
    );
  }

  return null;
}
