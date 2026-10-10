import { describe, expect, it, vi } from "vitest";

vi.mock("../services/plumber.js", () => ({ plumberClient: { getModels: vi.fn() } }));
vi.mock("../services/queue.js", () => ({ getJobQueue: vi.fn() }));
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../services/audit.js", () => ({ logAction: vi.fn(), extractClientInfo: vi.fn(() => ({})) }));

import { toPublicModelCatalog } from "./sdm-batch.js";

describe("public model catalog (F6)", () => {
  it("keeps only static catalog fields", () => {
    const out = toPublicModelCatalog([
      {
        id: "glm", label: "GLM", maturity: "stable", available: true, min_records: 10,
        packages: ["stats"], notes: "", complexity_tier: "simple", supports_uncertainty: false,
        user_id: "u-1", run_count: 4, internal_path: "/app/outputs", token: "x",
      },
    ]);
    expect(out).toEqual([
      {
        id: "glm", label: "GLM", maturity: "stable", available: true, min_records: 10,
        packages: ["stats"], notes: "", complexity_tier: "simple", supports_uncertainty: false,
      },
    ]);
  });

  it("returns an empty list for non-array or malformed responses", () => {
    expect(toPublicModelCatalog({ models: [] })).toEqual([]);
    expect(toPublicModelCatalog(null)).toEqual([]);
    expect(toPublicModelCatalog([null, "glm", ["x"]])).toEqual([]);
  });
});
