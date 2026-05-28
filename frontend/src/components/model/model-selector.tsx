"use client";

import { useMemo, useState } from "react";
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
  const pinned = settings?.pinnedModelIds ?? [];
  const [search, setSearch] = useState("");

  const togglePin = (id: string) => {
    const next = pinned.includes(id)
      ? pinned.filter((p) => p !== id)
      : [...pinned, id];
    updateSettings({ pinnedModelIds: next });
  };

  const grouped = useMemo(() => {
    const pinnedSet = new Set(pinned);
    const pinnedModels: ModelInfo[] = [];
    const tiered: Record<string, ModelInfo[]> = {};
    const unavailable: ModelInfo[] = [];

    TIER_ORDER.forEach((t) => { tiered[t] = []; });

    for (const m of models) {
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
      const items = tiered[t].filter((m) => m.available !== false);
      const notAvail = tiered[t].filter((m) => m.available === false);
      if (items.length > 0) sections.push({ title: t, items });
      if (notAvail.length > 0) sections.push({ title: `${t} (not installed)`, items: notAvail });
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
  }, [models, pinned, search]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (models.length === 0) { return null; }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2">
        <Search className="h-4 w-4 text-sdm-muted shrink-0" />
        <input
          type="text"
          placeholder="Search models by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent text-sm text-sdm-text placeholder:text-sdm-muted/60 outline-none"
        />
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
        {grouped.map((section) => {
          const isCollapsed = collapsed.has(section.title);
          return (
            <div key={section.title}>
              <button
                type="button"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (isCollapsed) next.delete(section.title);
                  else next.add(section.title);
                  setCollapsed(next);
                }}
                className="flex items-center gap-1.5 w-full text-left text-xs font-medium text-sdm-muted uppercase tracking-wider py-1"
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {section.title}
              </button>
              {!isCollapsed && (
                <div className="space-y-1">
                  {section.items.map((m) => {
                    const isSelected = selected === m.id;
                    const isPinned = pinned.includes(m.id);
                    const isInstalled = m.available !== false;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onSelect(m.id)}
                        className={cn(
                          "w-full text-left rounded-md border px-3 py-2.5 transition-colors",
                          isSelected
                            ? "border-sdm-accent bg-sdm-accent/10"
                            : "border-sdm-border/50 bg-sdm-surface-soft/50 hover:border-sdm-border hover:bg-sdm-surface-soft"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-sdm-text truncate">
                              {m.label}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                                maturityColors[m.maturity] ?? "bg-sdm-surface-soft text-sdm-muted border-sdm-border"
                              )}
                            >
                              {m.maturity}
                            </span>
                            {!isInstalled && (
                              <span className="shrink-0 rounded border border-sdm-border/30 bg-sdm-surface-soft px-1.5 py-0.5 text-[10px] leading-none text-sdm-muted">
                                Not installed
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); togglePin(m.id); }}
                            className={cn(
                              "shrink-0 p-0.5 transition-colors",
                              isPinned ? "text-sdm-warning" : "text-sdm-muted/40 hover:text-sdm-warning/60"
                            )}
                            title={isPinned ? "Unpin" : "Pin to top"}
                          >
                            <Star className={cn("h-3.5 w-3.5", isPinned ? "fill-sdm-warning" : "")} />
                          </button>
                        </div>

                        {(isSelected || isPinned || search) && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-sdm-muted">
                            {m.min_records != null && (
                              <span>≥ {m.min_records} records</span>
                            )}
                            {isInstalled && Array.isArray(m.packages) && m.packages.length > 0 && (
                              <span>Packages: {m.packages.join(", ")}</span>
                            )}
                            {!isInstalled && m.notes && (
                              <span className="text-sdm-muted">{m.notes}</span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
