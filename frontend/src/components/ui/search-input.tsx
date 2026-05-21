"use client";

import { Search, X } from "lucide-react";
import { useState, useEffect } from "react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search...", className = "" }: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localValue);
    }, 200);
    return () => clearTimeout(timer);
  }, [localValue, onChange]);

  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sdm-muted" />
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft pl-9 pr-8 py-2 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-1 focus:ring-sdm-accent/50 focus:border-sdm-accent/50"
      />
      {localValue && (
        <button
          onClick={() => setLocalValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-sdm-muted hover:text-sdm-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
