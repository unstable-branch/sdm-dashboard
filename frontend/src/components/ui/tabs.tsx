"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  id: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue>({
  value: "",
  id: "",
  onValueChange: () => {},
});

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue || "");
  const id = React.useId();
  const resolvedValue = value ?? internalValue;
  const resolvedOnChange = onValueChange ?? setInternalValue;

  return (
    <TabsContext.Provider value={{ value: resolvedValue, id, onValueChange: resolvedOnChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className,
  "aria-label": label,
}: {
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-sdm-surface-soft p-1 text-sdm-muted",
        className
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { value: selectedValue, id, onValueChange } = React.useContext(TabsContext);
  const isSelected = value === selectedValue;

  return (
    <button
      type="button"
      id={`${id}-tab-${value}`}
      role="tab"
      aria-selected={isSelected}
      aria-controls={`${id}-panel-${value}`}
      tabIndex={isSelected ? 0 : -1}
      data-state={isSelected ? "active" : "inactive"}
      onClick={() => onValueChange(value)}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onValueChange(value);
          return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const list = event.currentTarget.closest('[role="tablist"]');
        if (!list) return;
        const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
          .filter(tab => tab.closest('[role="tablist"]') === list && !tab.disabled);
        const index = tabs.indexOf(event.currentTarget);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? index + 1 : index - 1;
        tabs[(next + tabs.length) % tabs.length].focus();
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent disabled:pointer-events-none disabled:opacity-50",
        isSelected
          ? "bg-sdm-surface text-sdm-text shadow-sm"
          : "hover:text-sdm-text hover:bg-sdm-surface/50",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { value: selectedValue, id } = React.useContext(TabsContext);
  const isActive = value === selectedValue;

  return (
    <div
      id={`${id}-panel-${value}`}
      role="tabpanel"
      aria-labelledby={`${id}-tab-${value}`}
      tabIndex={0}
      data-state={isActive ? "active" : "inactive"}
      className={cn("mt-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sdm-accent", className)}
      hidden={!isActive}
    >
      {children}
    </div>
  );
}
