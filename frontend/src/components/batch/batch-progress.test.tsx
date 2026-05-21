import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BatchProgress } from "./batch-progress";

global.fetch = vi.fn();

const mockJobs = [
  { id: "run-1", species: "Acacia", model_id: "glm", status: "completed", metrics: { auc_mean: 0.85 } },
  { id: "run-2", species: "Eucalyptus", model_id: "maxnet", status: "running", metrics: null },
  { id: "run-3", species: "Pinus", model_id: "glm", status: "failed", metrics: null },
];

describe("BatchProgress", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockJobs[0]),
    } as Response);
  });

  it("shows batch progress header", () => {
    render(<BatchProgress jobIds={["run-1"]} />);
    expect(screen.getByText(/Batch Progress/i)).toBeInTheDocument();
  });

  it("shows completed/running/failed counts", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const id = url.split("/").pop();
      const job = mockJobs.find((j) => j.id === id);
      return {
        ok: true,
        json: () => Promise.resolve(job || mockJobs[0]),
      } as Response;
    });

    render(<BatchProgress jobIds={["run-1", "run-2", "run-3"]} />);

    await vi.waitFor(() => {
      expect(screen.getByText(/1\/3 completed/i)).toBeInTheDocument();
    });
  });

  it("shows progress bar", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const id = url.split("/").pop();
      const job = mockJobs.find((j) => j.id === id);
      return {
        ok: true,
        json: () => Promise.resolve(job || mockJobs[0]),
      } as Response;
    });

    render(<BatchProgress jobIds={["run-1", "run-2"]} />);

    await vi.waitFor(() => {
      expect(screen.getByText(/Batch Progress/i)).toBeInTheDocument();
      expect(screen.getByText(/1\/2 completed/i)).toBeInTheDocument();
    });
  });
});
