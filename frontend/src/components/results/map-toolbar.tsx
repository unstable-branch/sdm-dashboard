"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  GripVertical, Map, Hexagon, Grid3x3, Pentagon,
  Crop, Navigation, Maximize2, Sun, Moon,
} from "lucide-react";
import { TooltipRoot, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STORAGE_KEY_PREFIX = "sdm-map-toolbar-pos";
const LEGACY_STORAGE_KEY = "sdm-map-toolbar-pos";
const DEFAULT_POSITION: { x: number; y: number } = { x: 12, y: 12 };
const KEYBOARD_STEP = 10;
const SAVE_DEBOUNCE_MS = 200;
const BUTTON_SIZE_CLASS = "w-7 h-7";
const DRAG_HANDLE_CLASS = "w-7 h-5";

function loadPosition(runId?: string): { x: number; y: number } {
  if (typeof window === "undefined") return { ...DEFAULT_POSITION };
  try {
    const perRun = runId ? `${STORAGE_KEY_PREFIX}:${runId}` : null;
    const legacy = LEGACY_STORAGE_KEY;
    const key = perRun ?? legacy;
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return parsed;
      }
    }
    if (perRun) {
      const fallback = localStorage.getItem(legacy);
      if (fallback) {
        const parsed = JSON.parse(fallback);
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          return parsed;
        }
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_POSITION };
}

function savePosition(pos: { x: number; y: number }, runId?: string) {
  try {
    const key = runId ? `${STORAGE_KEY_PREFIX}:${runId}` : STORAGE_KEY_PREFIX;
    localStorage.setItem(key, JSON.stringify(pos));
  } catch { /* ignore */ }
}

interface ToolButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  labelActive: string;
  labelInactive: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

function ToolButton({ icon: Icon, labelActive, labelInactive, active, onClick, disabled, disabledReason }: ToolButtonProps) {
  const trigger = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-disabled={disabled}
      aria-label={active ? labelActive : labelInactive}
      title={disabled ? disabledReason : undefined}
      className={cn(
        BUTTON_SIZE_CLASS,
        "rounded-md flex items-center justify-center transition-colors shrink-0 relative",
        active
          ? "text-sdm-accent before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-sdm-accent"
          : "text-sdm-muted hover:text-sdm-text hover:bg-sdm-surface-soft",
        disabled && "opacity-30 cursor-not-allowed"
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  if (disabled) {
    return (
      <TooltipRoot>
        <TooltipTrigger asChild>
          <span tabIndex={-1}>{trigger}</span>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          {disabledReason ?? labelInactive}
        </TooltipContent>
      </TooltipRoot>
    );
  }

  return (
    <TooltipRoot>
      <TooltipTrigger asChild>
        {trigger}
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">
        {active ? labelActive : labelInactive}
      </TooltipContent>
    </TooltipRoot>
  );
}

interface MapToolbarProps {
  layers: Record<string, boolean>;
  onToggleLayer: (layer: string) => void;
  basemap: "light" | "dark";
  onToggleBasemap: () => void;
  onResetNorth: () => void;
  onFitExtent: () => void;
  disabledLayers?: string[];
  containerRef?: React.RefObject<HTMLDivElement | null>;
  runId?: string;
}

export function MapToolbar({
  layers,
  onToggleLayer,
  basemap,
  onToggleBasemap,
  onResetNorth,
  onFitExtent,
  disabledLayers,
  containerRef,
  runId,
}: MapToolbarProps) {
  const [position, setPosition] = useState({ ...DEFAULT_POSITION });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef({ ...DEFAULT_POSITION });
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);

  const clamp = useCallback((pos: { x: number; y: number }) => {
    const container = containerRef?.current;
    const toolbar = toolbarRef.current;
    if (!container || !toolbar) return pos;
    const cr = container.getBoundingClientRect();
    const tr = toolbar.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(pos.x, cr.width - tr.width)),
      y: Math.max(0, Math.min(pos.y, cr.height - tr.height)),
    };
  }, [containerRef]);

  const debouncedSave = useCallback((pos: { x: number; y: number }) => {
    if (saveTimeoutRef.current !== null) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      savePosition(pos, runId);
      saveTimeoutRef.current = null;
    }, SAVE_DEBOUNCE_MS);
  }, [runId]);

  useEffect(() => {
    const loaded = loadPosition(runId);
    setPosition(loaded);
    positionRef.current = loaded;
  }, [runId]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      setPosition((prev) => {
        const clamped = clamp(prev);
        debouncedSave(clamped);
        return clamped;
      });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, clamp, debouncedSave]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    toolbar.setPointerCapture(e.pointerId);

    const container = containerRef?.current;
    const containerRect = container?.getBoundingClientRect();
    if (!containerRect) return;

    const tr = toolbar.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const posX = tr.left - containerRect.left;
    const posY = tr.top - containerRect.top;
    let rafId: number | null = null;
    isDraggingRef.current = true;

    const handlePointerMove = (e: PointerEvent) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!isDraggingRef.current) return;
        const next = clamp({
          x: posX + e.clientX - startX,
          y: posY + e.clientY - startY,
        });
        positionRef.current = next;
        setPosition(next);
      });
    };
    const handlePointerUp = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      isDraggingRef.current = false;
      toolbar.removeEventListener("pointermove", handlePointerMove);
      toolbar.removeEventListener("pointerup", handlePointerUp);
      toolbar.removeEventListener("pointercancel", handlePointerUp);
      debouncedSave(positionRef.current);
    };

    toolbar.addEventListener("pointermove", handlePointerMove);
    toolbar.addEventListener("pointerup", handlePointerUp);
    toolbar.addEventListener("pointercancel", handlePointerUp);
  }, [clamp, containerRef, debouncedSave]);

  const handleDragKeyDown = useCallback((e: React.KeyboardEvent) => {
    const handled = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape"];
    if (!handled.includes(e.key)) return;
    e.preventDefault();

    if (e.key === "Escape" && isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }

    if (e.key === "Enter") {
      const next = { ...DEFAULT_POSITION };
      const clamped = clamp(next);
      positionRef.current = clamped;
      setPosition(clamped);
      debouncedSave(clamped);
      return;
    }

    setPosition((prev) => {
      const next = { x: prev.x, y: prev.y };
      if (e.key === "ArrowLeft") next.x -= KEYBOARD_STEP;
      if (e.key === "ArrowRight") next.x += KEYBOARD_STEP;
      if (e.key === "ArrowUp") next.y -= KEYBOARD_STEP;
      if (e.key === "ArrowDown") next.y += KEYBOARD_STEP;
      const clamped = clamp(next);
      positionRef.current = clamped;
      debouncedSave(clamped);
      return clamped;
    });
  }, [clamp, debouncedSave]);

  const disabledSet = useMemo(() => new Set(disabledLayers ?? []), [disabledLayers]);

  const disabledReason = (layer: string) => {
    const reasons: Record<string, string> = {
      suitability: "Suitability layer unavailable",
      eoo: "EOO polygon unavailable — no EOO GeoJSON",
      aoo: "AOO grid unavailable — no AOO GeoJSON",
      boundary: "Boundary polygon unavailable — no boundary GeoJSON",
      extent: "Projection extent unavailable",
    };
    return reasons[layer] ?? "Layer unavailable";
  };

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Map controls"
      className="absolute z-10 flex flex-col items-center gap-0.5 rounded-lg border border-sdm-border/50 bg-sdm-surface/90 backdrop-blur-sm shadow-lg px-1 py-1.5 select-none"
      style={{ top: position.y, left: position.x }}
    >
      <div
        onPointerDown={handlePointerDown}
        role="button"
        tabIndex={0}
        aria-label="Drag to reposition toolbar. Press Enter to reset position."
        onKeyDown={handleDragKeyDown}
        className={cn(
          DRAG_HANDLE_CLASS,
          "rounded-md flex items-center justify-center cursor-grab active:cursor-grabbing text-sdm-muted hover:text-sdm-text transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sdm-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sdm-surface"
        )}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>

      <div className="w-6 h-px bg-sdm-border/30 my-0.5" />

      <ToolButton
        icon={Map}
        labelActive="Hide suitability raster"
        labelInactive="Show suitability raster"
        active={layers.suitability}
        disabled={disabledSet.has("suitability")}
        disabledReason={disabledReason("suitability")}
        onClick={() => onToggleLayer("suitability")}
      />
      <ToolButton
        icon={Hexagon}
        labelActive="Hide EOO polygon"
        labelInactive="Show EOO polygon"
        active={layers.eoo}
        disabled={disabledSet.has("eoo")}
        disabledReason={disabledReason("eoo")}
        onClick={() => onToggleLayer("eoo")}
      />
      <ToolButton
        icon={Grid3x3}
        labelActive="Hide AOO grid"
        labelInactive="Show AOO grid"
        active={layers.aoo}
        disabled={disabledSet.has("aoo")}
        disabledReason={disabledReason("aoo")}
        onClick={() => onToggleLayer("aoo")}
      />
      <ToolButton
        icon={Pentagon}
        labelActive="Hide boundary polygon"
        labelInactive="Show boundary polygon"
        active={layers.boundary}
        disabled={disabledSet.has("boundary")}
        disabledReason={disabledReason("boundary")}
        onClick={() => onToggleLayer("boundary")}
      />
      <ToolButton
        icon={Crop}
        labelActive="Hide projection extent"
        labelInactive="Show projection extent"
        active={layers.extent}
        disabled={disabledSet.has("extent")}
        disabledReason={disabledReason("extent")}
        onClick={() => onToggleLayer("extent")}
      />

      <div className="w-6 h-px bg-sdm-border/30 my-0.5" />

      <ToolButton
        icon={Navigation}
        labelActive="Reset compass north"
        labelInactive="Reset compass north"
        onClick={onResetNorth}
      />
      <ToolButton
        icon={Maximize2}
        labelActive="Fit map to extent"
        labelInactive="Fit map to extent"
        onClick={onFitExtent}
      />

      <div className="w-6 h-px bg-sdm-border/30 my-0.5" />

      <ToolButton
        icon={basemap === "light" ? Moon : Sun}
        labelActive={basemap === "light" ? "Switch to dark basemap" : "Switch to light basemap"}
        labelInactive={basemap === "light" ? "Switch to dark basemap" : "Switch to light basemap"}
        onClick={onToggleBasemap}
      />
    </div>
  );
}
