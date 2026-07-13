import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResultsIndexPage from "./page";

vi.mock("@/hooks/use-runs", () => ({
  useRuns: () => ({
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    data: {
      runs: [{
        id: "run-1",
        species: "Test species",
        model_id: "dnn",
        status: "completed",
        started_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-01T00:00:12Z",
        metrics: null,
        output_files: null,
      }],
    },
  }),
}));

describe("results list", () => {
  it("renders typographic separators rather than HTML entity text", () => {
    render(<ResultsIndexPage />);
    expect(screen.getByText(/dnn · .* · 12s/)).toBeInTheDocument();
    expect(screen.queryByText(/&middot;/)).not.toBeInTheDocument();
  });
});
