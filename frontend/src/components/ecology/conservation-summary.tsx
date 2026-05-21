"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Info } from "lucide-react";

interface EcologyData {
  run_id: string;
  species: string;
  model_id: string;
  eoo_aoo?: {
    available: boolean;
    eoo_km2?: number;
    aoo_km2?: number;
    iucn_category?: string;
    message?: string;
  };
  aoa?: {
    available: boolean;
    png?: string;
    message?: string;
  };
  climate_matching?: {
    available: boolean;
    tif?: string;
    message?: string;
  };
  mess?: {
    available: boolean;
    mess_tif?: string;
    mod_tif?: string;
    pct_extrapolation?: number;
    message?: string;
  };
  niche_overlap?: Record<string, unknown>;
}

interface ConservationSummaryProps {
  runId: string;
}

const IUCN_THRESHOLDS = {
  CR: { eoo: 100, aoo: 10 },
  EN: { eoo: 5000, aoo: 500 },
  VU: { eoo: 20000, aoo: 2000 },
};

function IucnBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    CR: "bg-red-500/10 text-red-400 border-red-500/30",
    EN: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    VU: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    LC: "bg-green-500/10 text-green-400 border-green-500/30",
    NT: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    DD: "bg-sdm-muted/10 text-sdm-muted border-sdm-muted/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${colors[category] || colors.DD}`}>
      {category}
    </span>
  );
}

export function ConservationSummary({ runId }: ConservationSummaryProps) {
  const [data, setData] = useState<EcologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/ecology/${runId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Run not found");
        return res.json();
      })
      .then((d: EcologyData) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [runId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-sdm-accent" />
        <span className="ml-2 text-sm text-sdm-muted">Loading ecology data...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-300/30 bg-red-500/5 p-4 text-sm text-red-500">
        {error || "Failed to load ecology data"}
      </div>
    );
  }

  const eooAoo = data.eoo_aoo;
  const aoa = data.aoa;
  const climateMatching = data.climate_matching;
  const mess = data.mess;
  const nicheOverlap = data.niche_overlap as {
    D?: number | null;
    I?: number | null;
    stability?: number | null;
    unfilling?: number | null;
    expansion?: number | null;
    species_1?: string;
    species_2?: string;
  } | null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-sdm-heading">{data.species}</h2>
          <p className="text-xs text-sdm-muted">{data.model_id} model</p>
        </div>
      </div>

      {eooAoo && eooAoo.available ? (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Extent & Area of Occurrence
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">EOO</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">
                {eooAoo.eoo_km2 != null ? `${Math.round(eooAoo.eoo_km2).toLocaleString()} km²` : "—"}
              </p>
              <p className="text-xs text-sdm-muted mt-0.5">Extent of Occurrence</p>
            </div>
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">AOO</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">
                {eooAoo.aoo_km2 != null ? `${Math.round(eooAoo.aoo_km2).toLocaleString()} km²` : "—"}
              </p>
              <p className="text-xs text-sdm-muted mt-0.5">Area of Occupancy (2×2 km grid)</p>
            </div>
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">IUCN Guidance</p>
              <div className="mt-1">
                {eooAoo.iucn_category ? <IucnBadge category={eooAoo.iucn_category} /> : "—"}
              </div>
              <p className="text-xs text-sdm-muted mt-0.5">Red List category</p>
            </div>
          </div>

          {eooAoo.eoo_km2 != null && eooAoo.aoo_km2 != null && (
            <div className="rounded-md bg-sdm-surface-soft p-3 text-xs text-sdm-muted">
              <p className="font-medium text-sdm-text mb-1">IUCN Red List thresholds (Criterion B):</p>
              <div className="grid grid-cols-4 gap-2">
                <span className={eooAoo.eoo_km2 < IUCN_THRESHOLDS.CR.eoo ? "text-red-400 font-medium" : ""}>
                  CR: EOO &lt; {IUCN_THRESHOLDS.CR.eoo.toLocaleString()} km²
                </span>
                <span className={eooAoo.eoo_km2 < IUCN_THRESHOLDS.EN.eoo && eooAoo.eoo_km2 >= IUCN_THRESHOLDS.CR.eoo ? "text-orange-400 font-medium" : ""}>
                  EN: EOO &lt; {IUCN_THRESHOLDS.EN.eoo.toLocaleString()} km²
                </span>
                <span className={eooAoo.eoo_km2 < IUCN_THRESHOLDS.VU.eoo && eooAoo.eoo_km2 >= IUCN_THRESHOLDS.EN.eoo ? "text-yellow-400 font-medium" : ""}>
                  VU: EOO &lt; {IUCN_THRESHOLDS.VU.eoo.toLocaleString()} km²
                </span>
                <span>LC: above thresholds</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center gap-2 text-sm text-sdm-muted">
            <Info className="h-4 w-4" />
            EOO/AOO not computed for this run
          </div>
        </div>
      )}

      {aoa && aoa.available ? (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Area of Applicability
          </h3>
          {aoa.png && (
            <img
              src={`/api/v1/results/file/${encodeURIComponent(aoa.png)}`}
              alt="AOA mask"
              className="w-full rounded-lg border border-sdm-border"
            />
          )}
          <p className="text-xs text-sdm-muted">
            Areas within the model&apos;s applicability based on weighted distance to training data in environmental space.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center gap-2 text-sm text-sdm-muted">
            <Info className="h-4 w-4" />
            AOA not computed for this run
          </div>
        </div>
      )}

      {climateMatching && climateMatching.available ? (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Climate Matching
          </h3>
          <p className="text-xs text-sdm-muted">
            Similarity between projection area and training climate envelope.
          </p>
        </div>
      ) : null}

      {mess && mess.available ? (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            MESS Extrapolation
          </h3>
          {mess.pct_extrapolation != null && (
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Extrapolation</p>
              <p className={`mt-1 text-xl font-bold ${mess.pct_extrapolation > 20 ? "text-red-400" : mess.pct_extrapolation > 5 ? "text-yellow-400" : "text-green-400"}`}>
                {mess.pct_extrapolation.toFixed(1)}%
              </p>
              <p className="text-xs text-sdm-muted mt-0.5">of future projection beyond training envelope</p>
            </div>
          )}
          <p className="text-xs text-sdm-muted">
            MESS (Multivariate Environmental Similarity Surface) detects areas where future climate conditions fall outside the training data range.
          </p>
        </div>
      ) : null}

      {nicheOverlap && nicheOverlap.D != null ? (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Niche Overlap
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Schoener&apos;s D</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">{nicheOverlap.D.toFixed(3)}</p>
              <p className="text-xs text-sdm-muted mt-0.5">0 = no overlap, 1 = identical</p>
            </div>
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Hellinger&apos;s I</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">{nicheOverlap.I?.toFixed(3) ?? "—"}</p>
              <p className="text-xs text-sdm-muted mt-0.5">Hellinger distance-based overlap</p>
            </div>
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Stability</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">{((nicheOverlap.stability ?? 0) * 100).toFixed(1)}%</p>
              <p className="text-xs text-sdm-muted mt-0.5">Shared niche space</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs text-sdm-muted">
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="font-medium text-sdm-text">Expansion: {((nicheOverlap.expansion ?? 0) * 100).toFixed(1)}%</p>
              <p>New environmental space occupied by second species</p>
            </div>
            <div className="rounded-md bg-sdm-surface-soft p-3">
              <p className="font-medium text-sdm-text">Unfilling: {((nicheOverlap.unfilling ?? 0) * 100).toFixed(1)}%</p>
              <p>Niche space lost between ranges</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
