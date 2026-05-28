"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface SpeciesInputProps {
  species: string;
  speciesFiltered: string[];
  speciesSelectedIndex: number;
  onSpeciesChange: (value: string) => void;
  onSelect: (value: string) => void;
  onFocus: (focused: boolean) => void;
  onKeyNav: (dir: "up" | "down" | "enter" | "escape") => void;
  focused: boolean;
}

export function SpeciesInput({
  species,
  speciesFiltered,
  speciesSelectedIndex,
  onSpeciesChange,
  onSelect,
  onFocus,
  onKeyNav,
  focused,
}: SpeciesInputProps) {
  return (
    <div className="relative">
      <label className="block text-sm font-medium text-sdm-text mb-1">Species / model label</label>
      <input
        type="text"
        value={species}
        onChange={(e) => onSpeciesChange(e.target.value)}
        onFocus={() => onFocus(true)}
        onBlur={() => setTimeout(() => onFocus(false), 200)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); onKeyNav("down"); }
          else if (e.key === "ArrowUp") { e.preventDefault(); onKeyNav("up"); }
          else if (e.key === "Enter" && speciesSelectedIndex >= 0 && speciesSelectedIndex < speciesFiltered.length) {
            e.preventDefault();
            onKeyNav("enter");
          } else if (e.key === "Escape") { onKeyNav("escape"); }
        }}
        className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
        placeholder="Enter species name or select from history"
        role="combobox"
        aria-expanded={focused && speciesFiltered.length > 0}
        aria-haspopup="listbox"
        aria-autocomplete="list"
      />
      {focused && speciesFiltered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-sdm-border bg-sdm-surface shadow-lg max-h-48 overflow-y-auto" role="listbox">
          {speciesFiltered.map((s, idx) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={idx === speciesSelectedIndex}
              onMouseDown={() => onSelect(s)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm text-sdm-text hover:bg-sdm-surface-soft",
                idx === speciesSelectedIndex && "bg-sdm-accent/10"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
