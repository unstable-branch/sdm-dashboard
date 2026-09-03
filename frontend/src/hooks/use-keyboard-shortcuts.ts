import { useEffect, useCallback, useRef } from "react";

/**
 * Maps keyboard shortcuts to map action handlers.
 * Shortcuts are ignored when the target element is an input, textarea,
 * or contentEditable element to avoid interfering with form fields.
 */
interface KeyboardShortcutHandlers {
  /** Reset the map compass to north (bearing = 0) */
  onResetNorth: () => void;
  /** Fit the map view to the current extent bounds */
  onFitExtent: () => void;
  /** Toggle between light and dark basemap */
  onToggleBasemap: () => void;
  /** Zoom the map in one level */
  onZoomIn: () => void;
  /** Zoom the map out one level */
  onZoomOut: () => void;
  /** Toggle map pitch between 0° (flat) and 60° (tilted 3D) */
  onPitchToggle: () => void;
}

/**
 * Registers keyboard shortcuts for map navigation.
 *
 * Shortcuts:
 * - `n` / `N` — Reset compass north
 * - `f` / `F` — Fit map to extent
 * - `b` / `B` — Toggle basemap
 * - `+` / `=` — Zoom in
 * - `-` / `_` — Zoom out
 * - `p` / `P` — Toggle map pitch (0° / 60°)
 *
 * Shortcuts are suppressed when focus is inside an input, textarea, or
 * contentEditable element.
 *
 * @param handlers - Map action callbacks for each shortcut
 */
export function useKeyboardShortcuts({
  onResetNorth,
  onFitExtent,
  onToggleBasemap,
  onZoomIn,
  onZoomOut,
  onPitchToggle,
}: KeyboardShortcutHandlers) {
  const handlersRef = useRef({ onResetNorth, onFitExtent, onToggleBasemap, onZoomIn, onZoomOut, onPitchToggle });
  handlersRef.current = { onResetNorth, onFitExtent, onToggleBasemap, onZoomIn, onZoomOut, onPitchToggle };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          handlersRef.current.onResetNorth();
          break;
        case "f":
        case "F":
          e.preventDefault();
          handlersRef.current.onFitExtent();
          break;
        case "b":
        case "B":
          e.preventDefault();
          handlersRef.current.onToggleBasemap();
          break;
        case "+":
        case "=":
          e.preventDefault();
          handlersRef.current.onZoomIn();
          break;
        case "-":
        case "_":
          e.preventDefault();
          handlersRef.current.onZoomOut();
          break;
        case "p":
        case "P":
          e.preventDefault();
          handlersRef.current.onPitchToggle();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
