"use client";

import { useId, useMemo, useRef, useState } from "react";
import { MODEL_TIERS, TIER_ORDER } from "@sdm/shared";
import { Star, Search, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

interface ModelInfo {
  id: string;
  label: string;
  maturity: string;
  min_records?: number | null;
  packages?: string[];
  notes?: string;
  available?: boolean;
  complexity_tier?: string;
}

interface ModelSelectorProps {
  models: ModelInfo[];
  selected: string;
  onSelect: (id: string) => void;
}

const maturityColors: Record<string, string> = {
  stable: "bg-sdm-success/15 text-sdm-success border-sdm-success/30",
  experimental: "bg-sdm-warning/15 text-sdm-warning border-sdm-warning/30",
  deprecated: "bg-sdm-danger/15 text-sdm-danger border-sdm-danger/30",
};

export function ModelSelector({ models, selected, onSelect }: ModelSelectorProps) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [pinned, setPinned] = useState<string[]>(() => settings?.pinnedModelIds ?? []);
  const [search, setSearch] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(true);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const catalogId = useId();
  const selectedModel = models.find((model) => model.id === selected);

  const togglePin = (id: string) => {
    const next = pinned.includes(id)
      ? pinned.filter((p) => p !== id)
      : [...pinned, id];
    setPinned(next);
    updateSettings({ pinnedModelIds: next });
  };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const pinnedSet = new Set(pinned);
    const pinnedModels: ModelInfo[] = [];
    const tiered: Record<string, ModelInfo[]> = {};
    const unavailable: ModelInfo[] = [];

    TIER_ORDER.forEach((t) => { tiered[t] = []; });

    for (const m of models) {
      if (availableOnly && m.available !== true) continue;
      if (pinnedSet.has(m.id)) {
        pinnedModels.push(m);
        continue;
      }
      const tier = MODEL_TIERS[m.id];
      if (tier && tiered[tier]) {
        tiered[tier].push(m);
      } else {
        unavailable.push(m);
      }
    }

    const sections: { title: string; items: ModelInfo[] }[] = [];

    if (pinnedModels.length > 0) {
      sections.push({ title: `Pinned (${pinnedModels.length})`, items: pinnedModels });
    }

    const shownTiers = TIER_ORDER.filter((t) => (tiered[t]?.length ?? 0) > 0);
    for (const t of shownTiers) {
      sections.push({ title: t, items: tiered[t] });
    }

    if (unavailable.length > 0) {
      sections.push({ title: "Other", items: unavailable });
    }

    if (!search) return sections;

    const q = search.toLowerCase();
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q) ||
            (m.notes ?? "").toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [models, pinned, search, availableOnly]);

  if (models.length === 0) { return null; }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sdm-accent/30 bg-sdm-accent/5 p-4">
        <p className="mb-2 text-xs font-medium text-sdm-muted">Selected model</p>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-sdm-heading">{selectedModel?.label || selected || "No model selected"}</h3>
          {selectedModel && <span className={cn("rounded-md border px-2 py-1 text-xs", maturityColors[selectedModel.maturity])}>{selectedModel.maturity}</span>}
        </div>
        {selectedModel && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-sdm-muted">
            {Number.isFinite(selectedModel.min_records) && <span>≥ {selectedModel.min_records} records</span>}
            <span>{selectedModel.available === true ? "Installed" : selectedModel.available === false ? "Not installed" : "Availability not checked"}</span>
            {selectedModel.packages?.length ? <span>Packages: {selectedModel.packages.join(", ")}</span> : null}
          </div>
        )}
        {selectedModel?.notes && <p className="mt-3 text-sm leading-relaxed text-sdm-muted">{selectedModel.notes}</p>}
        <button ref={toggleRef} type="button" aria-expanded={browseOpen} aria-controls={catalogId}
          onClick={() => setBrowseOpen(!browseOpen)}
          className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-sdm-border bg-sdm-surface px-3 py-2 text-sm font-medium text-sdm-heading hover:border-sdm-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent">
          Change model
          <ChevronDown className={cn("h-4 w-4", browseOpen && "rotate-180")} aria-hidden="true" />
        </button>
      </div>
      {browseOpen && <div id={catalogId} className="space-y-4 rounded-xl border border-sdm-border p-4">
      <div className="flex flex-wrap items-center gap-2" aria-label="Model availability filter">
        <button type="button" aria-pressed={availableOnly} onClick={() => setAvailableOnly(true)} className={cn("min-h-10 rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent", availableOnly ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>Available models</button>
        <button type="button" aria-pressed={!availableOnly} onClick={() => setAvailableOnly(false)} className={cn("min-h-10 rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent", !availableOnly ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>All models</button>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2">
        <Search className="h-4 w-4 text-sdm-muted shrink-0" />
        <input
          type="search"
          aria-label="Search models"
          placeholder="Search models by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent text-sm text-sdm-text placeholder:text-sdm-muted/60 outline-none"
        />
      </div>

      {grouped.length === 0 && <p role="status" className="text-sm text-sdm-muted">No models match. Try another search or choose All models to include models that are not installed or whose availability has not been checked.</p>}
      <div className="space-y-4">
        {grouped.map((section) => {
          const isCollapsed = !search && collapsed.has(section.title);
          const sectionId = `${catalogId}-${section.title.replace(/[^a-zA-Z0-9]/g, "-")}`;
          return (
            <div key={section.title}>
              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-controls={sectionId}
                onClick={() => {
                  const next = new Set(collapsed);
                  if (isCollapsed) next.delete(section.title);
                  else next.add(section.title);
                  setCollapsed(next);
                }}
                className="flex items-center gap-1.5 w-full text-left text-xs font-medium text-sdm-muted uppercase tracking-wider py-1"
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {section.title} ({section.items.length})
              </button>
              {!isCollapsed && (
                <div id={sectionId} className="space-y-2">
                  {section.items.map((m) => {
                    const itemSelected = selected === m.id;
                    const isPinned = pinned.includes(m.id);
                    const isInstalled = m.available === true;
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "flex w-full items-start rounded-lg border transition-colors",
                          itemSelected
                            ? "border-sdm-accent bg-sdm-accent/10"
                            : "border-sdm-border/50 bg-sdm-surface-soft/50 hover:border-sdm-border hover:bg-sdm-surface-soft"
                        )}
                      >
                        <button type="button" aria-label={`Select ${m.label}`} aria-pressed={itemSelected}
                          onClick={() => { onSelect(m.id); setBrowseOpen(false); toggleRef.current?.focus(); }}
                          className="min-w-0 flex-1 rounded-lg px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="w-full text-sm font-medium leading-relaxed text-sdm-text">{m.label}</span>
                            <span
                              className={cn(
                                "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                                maturityColors[m.maturity] ?? "bg-sdm-surface-soft text-sdm-muted border-sdm-border"
                              )}
                            >
                              {`${m.maturity}`}
                            </span>
                            {m.complexity_tier && (
                              <span className="shrink-0 rounded border border-sdm-accent/20 bg-sdm-accent/5 px-1.5 py-0.5 text-[10px] font-medium leading-none text-sdm-accent">
                                {m.complexity_tier}
                              </span>
                            )}
                            {!isInstalled && (
                              <span className="shrink-0 rounded border border-sdm-border/30 bg-sdm-surface-soft px-1.5 py-0.5 text-[10px] leading-none text-sdm-muted">
                                {m.available === false ? "Not installed" : "Availability not checked"}
                              </span>
                            )}
                          </div>

                        {(itemSelected || isPinned || search) && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-sdm-muted">
                            {(() => {
                              const val = m.min_records;
                              return Number.isFinite(val) ? <span>{`≥ ${val} records`}</span> : null;
                            })()}
                            {isInstalled && Array.isArray(m.packages) && m.packages.length > 0 && (
                              <span>{`Packages: ${m.packages.join(", ")}`}</span>
                            )}
                            {!isInstalled && m.notes && (
                              <span className="text-sdm-muted">{m.notes}</span>
                            )}
                          </div>
                        )}
                        </button>
                        <button type="button" aria-label={`${isPinned ? "Unpin" : "Pin"} ${m.label}`} aria-pressed={isPinned}
                          onClick={() => togglePin(m.id)}
                          className={cn("m-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent hover:bg-sdm-surface", isPinned ? "text-sdm-warning" : "text-sdm-muted") }>
                          <Star className={cn("h-4 w-4", isPinned && "fill-sdm-warning")} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>}
    </div>
  );
}
