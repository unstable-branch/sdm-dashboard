import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportPanel } from "./export-panel";
import { publishSessionChanged, withSessionMutation } from "@/services/session-coordinator";

describe("ecology report transport", () => {
  beforeEach(() => {
    localStorage.clear();
    class TestChannel { onmessage: ((event: MessageEvent) => void) | null = null; postMessage() {} }
    vi.stubGlobal("BroadcastChannel", TestChannel);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: vi.fn(async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback()) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  });

  it("does not publish a deferred report body after the session changes", async () => {
    let finishBody!: (body: string) => void;
    const response = new Response(null, { status: 200 });
    response.text = vi.fn(() => new Promise<string>((resolve) => { finishBody = resolve; }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    render(<ExportPanel runId="run-a" />);

    fireEvent.click(screen.getByRole("button", { name: /Generate report/ }));
    await waitFor(() => expect(response.text).toHaveBeenCalledOnce());
    await withSessionMutation(async () => { publishSessionChanged(); });
    await act(async () => { finishBody("private report from prior principal"); });

    expect(screen.queryByText("private report from prior principal")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed to generate report")).not.toBeInTheDocument();
  });
});
