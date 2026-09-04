import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";

function TestComponent({
  onResetNorth = vi.fn(),
  onFitExtent = vi.fn(),
  onToggleBasemap = vi.fn(),
  onZoomIn = vi.fn(),
  onZoomOut = vi.fn(),
  onPitchToggle = vi.fn(),
}: {
  onResetNorth?: () => void;
  onFitExtent?: () => void;
  onToggleBasemap?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onPitchToggle?: () => void;
}) {
  useKeyboardShortcuts({
    onResetNorth,
    onFitExtent,
    onToggleBasemap,
    onZoomIn,
    onZoomOut,
    onPitchToggle,
  });
  return <div>test</div>;
}

describe("useKeyboardShortcuts", () => {
  const handlers = {
    onResetNorth: vi.fn(),
    onFitExtent: vi.fn(),
    onToggleBasemap: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onPitchToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function dispatchKeydown(key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true });
    window.dispatchEvent(event);
  }

  it("calls onResetNorth on 'n'", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("n");
    expect(handlers.onResetNorth).toHaveBeenCalledTimes(1);
  });

  it("calls onResetNorth on 'N' (uppercase)", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("N");
    expect(handlers.onResetNorth).toHaveBeenCalledTimes(1);
  });

  it("calls onFitExtent on 'f'", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("f");
    expect(handlers.onFitExtent).toHaveBeenCalledTimes(1);
  });

  it("calls onFitExtent on 'F' (uppercase)", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("F");
    expect(handlers.onFitExtent).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleBasemap on 'b'", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("b");
    expect(handlers.onToggleBasemap).toHaveBeenCalledTimes(1);
  });

  it("calls onZoomIn on '+'", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("+");
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
  });

  it("calls onZoomIn on '='", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("=");
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
  });

  it("calls onZoomOut on '-'", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("-");
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("calls onZoomOut on '_' (shift+minus)", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("_");
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("calls onPitchToggle on 'p'", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("p");
    expect(handlers.onPitchToggle).toHaveBeenCalledTimes(1);
  });

  it("calls onPitchToggle on 'P' (uppercase)", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("P");
    expect(handlers.onPitchToggle).toHaveBeenCalledTimes(1);
  });

  it("does not call any handler for unrelated keys", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("ArrowUp");
    expect(handlers.onResetNorth).not.toHaveBeenCalled();
    expect(handlers.onFitExtent).not.toHaveBeenCalled();
  });

  it("does not fire when target is an input element", () => {
    render(
      <div>
        <input data-testid="input" type="text" />
        <TestComponent {...handlers} />
      </div>
    );
    fireEvent.keyDown(screen.getByTestId("input"), { key: "n" });
    expect(handlers.onResetNorth).not.toHaveBeenCalled();
  });

  it("does not fire when target is a textarea element", () => {
    render(
      <div>
        <textarea data-testid="textarea" />
        <TestComponent {...handlers} />
      </div>
    );
    fireEvent.keyDown(screen.getByTestId("textarea"), { key: "f" });
    expect(handlers.onFitExtent).not.toHaveBeenCalled();
  });

  it("does not fire when target is a contentEditable element", () => {
    render(
      <div>
        <div data-testid="editable" contentEditable />
        <TestComponent {...handlers} />
      </div>
    );
    fireEvent.keyDown(screen.getByTestId("editable"), { key: "b" });
    expect(handlers.onToggleBasemap).not.toHaveBeenCalled();
  });

  it("calls correct handlers for multiple keys in sequence", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("n");
    dispatchKeydown("f");
    dispatchKeydown("p");
    expect(handlers.onResetNorth).toHaveBeenCalledTimes(1);
    expect(handlers.onFitExtent).toHaveBeenCalledTimes(1);
    expect(handlers.onPitchToggle).toHaveBeenCalledTimes(1);
  });

  it("'-' does not trigger onZoomIn", () => {
    render(<TestComponent {...handlers} />);
    dispatchKeydown("-");
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
  });
});
