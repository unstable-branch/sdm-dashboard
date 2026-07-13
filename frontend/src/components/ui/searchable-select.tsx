"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface SearchableSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  allLabel?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search...",
  disabled = false,
  loading = false,
  className,
  allLabel,
}: SearchableSelectProps) {
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const displayValue = !focused
    ? (value === "all" && allLabel ? allLabel : value || "")
    : search;

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => {
      const label = o === "all" && allLabel ? allLabel : o;
      return label.toLowerCase().includes(q);
    });
  }, [options, search, allLabel]);

  const handleSelect = useCallback(
    (option: string) => {
      onChange(option);
      setSearch("");
      setFocused(false);
      setSelectedIndex(-1);
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredOptions.length - 1 ? prev + 1 : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredOptions.length - 1,
      );
    } else if (
      e.key === "Enter" &&
      selectedIndex >= 0 &&
      selectedIndex < filteredOptions.length
    ) {
      e.preventDefault();
      handleSelect(filteredOptions[selectedIndex]);
    } else if (e.key === "Escape") {
      setFocused(false);
      setSearch("");
      setSelectedIndex(-1);
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.children;
      if (items[selectedIndex]) {
        (items[selectedIndex] as HTMLElement).scrollIntoView({
          block: "nearest",
        });
      }
    }
  }, [selectedIndex]);

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        onChange={(e) => {
          setSearch(e.target.value);
          setSelectedIndex(-1);
        }}
        onFocus={() => {
          setFocused(true);
          setSearch("");
        }}
        onBlur={() =>
          setTimeout(() => {
            setFocused(false);
            setSearch("");
            setSelectedIndex(-1);
          }, 200)
        }
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={focused && filteredOptions.length > 0}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none disabled:opacity-40"
      />
      {loading && (
        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
          <Loader2 className="h-4 w-4 animate-spin text-sdm-muted" />
        </div>
      )}
      {focused && filteredOptions.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full rounded-md border border-sdm-border bg-sdm-surface shadow-lg max-h-48 overflow-y-auto"
          role="listbox"
        >
          {filteredOptions.map((option, idx) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={idx === selectedIndex}
              onMouseDown={() => handleSelect(option)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm text-sdm-text hover:bg-sdm-surface-soft",
                idx === selectedIndex && "bg-sdm-accent/10",
              )}
            >
              {option === "all" && allLabel ? allLabel : option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
