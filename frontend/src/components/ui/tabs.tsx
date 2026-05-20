"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue>({
  value: "",
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
  const resolvedValue = value ?? internalValue;
  const resolvedOnChange = onValueChange ?? setInternalValue;

  return (
    <TabsContext.Provider value={{ value: resolvedValue, onValueChange: resolvedOnChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
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
  const { value: selectedValue, onValueChange } = React.useContext(TabsContext);
  const isSelected = value === selectedValue;

  return (
    <button
      role="tab"
      data-state={isSelected ? "active" : "inactive"}
      onClick={() => onValueChange(value)}
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
  const { value: selectedValue } = React.useContext(TabsContext);
  if (value !== selectedValue) return null;

  return (
    <div
      role="tabpanel"
      data-state={value === selectedValue ? "active" : "inactive"}
      className={cn("mt-2 focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
