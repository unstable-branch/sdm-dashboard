"use client";

import { useState, useEffect } from "react";

interface FutureProjectionPanelProps {
  outputFiles: Record<string, string> | null;
  config?: Record<string, unknown>;
}

interface ScenarioData {
  label: string;
  futurePng: string | null;
  deltaPng: string | null;
  futureTif: string | null;
  deltaTif: string | null;
  messTif: string | null;
  modTif: string | null;
}

export function FutureProjectionPanel({ outputFiles, config }: FutureProjectionPanelProps) {
  const [scenarios, setScenarios] = useState<ScenarioData[]>([]);
  const [activeScenario, setActiveScenario] = useState(0);

  useEffect(() => {
    if (!outputFiles) return;

    const found: ScenarioData[] = [];

    const futurePng = outputFiles.future_suitability_png;
    const deltaPng = outputFiles.future_delta_png;
    if (futurePng || deltaPng) {
      found.push({
        label: (config?.future_label as string) || "Future climate",
        futurePng: futurePng ? `/api/v1/results/file/${encodeURIComponent(futurePng)}` : null,
        deltaPng: deltaPng ? `/api/v1/results/file/${encodeURIComponent(deltaPng)}` : null,
        futureTif: outputFiles.future_suitability_tif || null,
        deltaTif: outputFiles.future_delta_tif || null,
        messTif: outputFiles.future_mess_tif || null,
        modTif: outputFiles.future_mod_tif || null,
      });
    }

    const future2Png = outputFiles.future2_suitability_png;
    const delta2Png = outputFiles.future2_delta_png;
    if (future2Png || delta2Png) {
      found.push({
        label: (config?.future_label2 as string) || "Future climate 2",
        futurePng: future2Png ? `/api/v1/results/file/${encodeURIComponent(future2Png)}` : null,
        deltaPng: delta2Png ? `/api/v1/results/file/${encodeURIComponent(delta2Png)}` : null,
        futureTif: outputFiles.future2_suitability_tif || null,
        deltaTif: outputFiles.future2_delta_tif || null,
        messTif: outputFiles.future2_mess_tif || null,
        modTif: outputFiles.future2_mod_tif || null,
      });
    }

    setScenarios(found);
  }, [outputFiles, config]);

  if (scenarios.length === 0) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        This run was not configured with future projection. Re-run with &quot;Project future scenario&quot; enabled.
      </div>
    );
  }

  const scenario = scenarios[activeScenario];

  return (
    <div className="space-y-4">
      {scenarios.length > 1 && (
        <div className="flex gap-2">
          {scenarios.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveScenario(i)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                i === activeScenario
                  ? "bg-sdm-accent text-white"
                  : "bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {scenario.futurePng && (
          <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
            <img src={scenario.futurePng} alt={`${scenario.label} suitability`} className="w-full" />
            <div className="px-4 py-2 border-t border-sdm-border flex items-center justify-between text-xs text-sdm-muted">
              <span>{scenario.label} — predicted suitability</span>
              {scenario.futureTif && (
                <a href={`/api/v1/results/file/${encodeURIComponent(scenario.futureTif)}`} className="text-sdm-accent hover:underline">
                  Download GeoTIFF
                </a>
              )}
            </div>
          </div>
        )}

        {scenario.deltaPng && (
          <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
            <img src={scenario.deltaPng} alt={`${scenario.label} delta`} className="w-full" />
            <div className="px-4 py-2 border-t border-sdm-border flex items-center justify-between text-xs text-sdm-muted">
              <span>{scenario.label} — suitability delta (future minus current)</span>
              {scenario.deltaTif && (
                <a href={`/api/v1/results/file/${encodeURIComponent(scenario.deltaTif)}`} className="text-sdm-accent hover:underline">
                  Download GeoTIFF
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {(scenario.messTif || scenario.modTif) && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <h3 className="text-sm font-semibold text-sdm-heading mb-2">Extrapolation diagnostics</h3>
          <div className="flex flex-wrap gap-3 text-xs text-sdm-muted">
            {scenario.messTif && (
              <a href={`/api/v1/results/file/${encodeURIComponent(scenario.messTif)}`} className="text-sdm-accent hover:underline">
                MESS surface (TIFF)
              </a>
            )}
            {scenario.modTif && (
              <a href={`/api/v1/results/file/${encodeURIComponent(scenario.modTif)}`} className="text-sdm-accent hover:underline">
                MOD surface (TIFF)
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
