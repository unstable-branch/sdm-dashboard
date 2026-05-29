"use client";

import { useMemo, useState } from "react";
import { MODEL_TIERS, TIER_ORDER } from "@sdm/shared";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function ModelSelector({ models, selected, onSelect }: ModelSelectorProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const pinnedSet = new Set<string>();
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
  }, [models, search]);

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
                {section.title} ({section.items.length})
              </button>
              {!isCollapsed && (
                <div className="space-y-1">
                  {section.items.map((m) => {
                    const itemSelected = selected === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onSelect(m.id)}
                        className={cn(
                          "w-full text-left rounded-md border px-3 py-2.5 transition-colors",
                          itemSelected
                            ? "border-sdm-accent bg-sdm-accent/10"
                            : "border-sdm-border/50 bg-sdm-surface-soft/50 hover:border-sdm-border hover:bg-sdm-surface-soft"
                        )}
                      >
                        <span className="text-sm font-medium text-sdm-text truncate">{m.label}</span>
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
