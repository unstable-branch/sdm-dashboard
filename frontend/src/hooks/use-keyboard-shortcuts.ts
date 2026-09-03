import { useEffect, useCallback, useRef } from "react";

interface KeyboardShortcutHandlers {
  onResetNorth: () => void;
  onFitExtent: () => void;
  onToggleBasemap: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPitchToggle: () => void;
}

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
