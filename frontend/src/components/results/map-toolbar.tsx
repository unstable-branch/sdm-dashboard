"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  GripVertical, Layers, MapPin, Grid3x3, Globe,
  Crop, Navigation, Maximize2, Sun, Moon,
} from "lucide-react";
import { TooltipRoot, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "sdm-map-toolbar-pos";

function loadPosition(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 12, y: 12 };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return { x: 12, y: 12 };
}

function savePosition(pos: { x: number; y: number }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch { /* ignore */ }
}

interface ToolButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  labelActive: string;
  labelInactive: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

function ToolButton({ icon: Icon, labelActive, labelInactive, active, onClick, disabled }: ToolButtonProps) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          title=""
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center transition-colors shrink-0 relative",
            active
              ? "text-sdm-accent before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-sdm-accent"
              : "text-sdm-muted hover:text-sdm-text hover:bg-sdm-surface-soft",
            disabled && "opacity-30 cursor-not-allowed"
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
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
}: MapToolbarProps) {
  const [position, setPosition] = useState(loadPosition);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);

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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const tr = toolbar.getBoundingClientRect();
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, posX: tr.left, posY: tr.top };
  }, []);

  useEffect(() => {
    if (!dragging.current) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const next = clamp({
        x: dragStart.current.posX + dx,
        y: dragStart.current.posY + dy,
      });
      setPosition(next);
    };
    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      savePosition(position);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [clamp, position]);

  const disabledSet = new Set(disabledLayers ?? []);

  return (
    <div
      ref={toolbarRef}
      className="absolute z-10 flex flex-col items-center gap-0.5 rounded-lg border border-sdm-border/50 bg-sdm-surface/90 backdrop-blur-sm shadow-lg px-1 py-1.5 select-none"
      style={{ top: position.y, left: position.x }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-7 h-5 rounded-md flex items-center justify-center cursor-grab active:cursor-grabbing text-sdm-muted hover:text-sdm-text transition-colors"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>

      <div className="w-6 h-px bg-sdm-border/30 my-0.5" />

      {/* Layer toggles */}
      <ToolButton
        icon={Layers}
        labelActive="Hide suitability raster"
        labelInactive="Show suitability raster"
        active={layers.suitability}
        disabled={disabledSet.has("suitability")}
        onClick={() => onToggleLayer("suitability")}
      />
      <ToolButton
        icon={MapPin}
        labelActive="Hide EOO polygon"
        labelInactive="Show EOO polygon"
        active={layers.eoo}
        disabled={disabledSet.has("eoo")}
        onClick={() => onToggleLayer("eoo")}
      />
      <ToolButton
        icon={Grid3x3}
        labelActive="Hide AOO grid"
        labelInactive="Show AOO grid"
        active={layers.aoo}
        disabled={disabledSet.has("aoo")}
        onClick={() => onToggleLayer("aoo")}
      />
      <ToolButton
        icon={Globe}
        labelActive="Hide boundary polygon"
        labelInactive="Show boundary polygon"
        active={layers.boundary}
        disabled={disabledSet.has("boundary")}
        onClick={() => onToggleLayer("boundary")}
      />
      <ToolButton
        icon={Crop}
        labelActive="Hide projection extent"
        labelInactive="Show projection extent"
        active={layers.extent}
        disabled={disabledSet.has("extent")}
        onClick={() => onToggleLayer("extent")}
      />

      <div className="w-6 h-px bg-sdm-border/30 my-0.5" />

      {/* View controls */}
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

      {/* Basemap toggle */}
      <ToolButton
        icon={basemap === "light" ? Moon : Sun}
        labelActive={basemap === "light" ? "Switch to dark basemap" : "Switch to light basemap"}
        labelInactive={basemap === "light" ? "Switch to dark basemap" : "Switch to light basemap"}
        onClick={onToggleBasemap}
      />
    </div>
  );
}
