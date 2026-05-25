import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STATUS_SCHEMA,
  buildWorkflowStatusLayer,
  normalizeWorkflowStatus,
} from "./workflow-status.js";

describe("workflow status helpers", () => {
  it("builds the additive workflow status layer for active runs", () => {
    expect(buildWorkflowStatusLayer({ id: "run-1", status: "running", error: null })).toEqual({
      status_schema: WORKFLOW_STATUS_SCHEMA,
      run_id: "run-1",
      workflow_id: "run-1",
      status: "running",
      terminal: false,
      progress_percent: null,
      poll_after_ms: 2000,
      error: null,
    });
  });

  it("marks completed runs terminal and derives 100 percent progress", () => {
    expect(buildWorkflowStatusLayer({ id: "run-2", status: "completed", error: null })).toEqual(expect.objectContaining({
      status: "completed",
      terminal: true,
      progress_percent: 100,
      poll_after_ms: null,
      error: null,
    }));
  });

  it("normalizes failed errors and clamps progress from an already-fetched status payload", () => {
    expect(buildWorkflowStatusLayer(
      { id: "run-3", status: "running", error: null },
      { status: "failed", error: "Plumber failed", progress_percent: 150 },
    )).toEqual(expect.objectContaining({
      status: "failed",
      terminal: true,
      progress_percent: 100,
      poll_after_ms: null,
      error: "Plumber failed",
    }));
  });

  it("preserves existing run error strings as normalized string/null errors", () => {
    expect(buildWorkflowStatusLayer({ id: "run-5", status: "cancelled", error: "Cancelled by user" })).toEqual(expect.objectContaining({
      error: "Cancelled by user",
    }));
  });

  it("maps unknown lifecycle values to unknown", () => {
    expect(normalizeWorkflowStatus("stalled")).toBe("unknown");
    expect(buildWorkflowStatusLayer({ id: "run-4", status: "stalled" }).status).toBe("unknown");
  });
});
