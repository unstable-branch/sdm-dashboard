import { describe, expect, it } from "vitest";
import { openApiDocument } from "./openapi.js";

describe("openApiDocument baseline", () => {
  it("includes required baseline paths", () => {
    const requiredPaths = [
      "/health",
      "/ready",
      "/api/v1/auth/register",
      "/api/v1/auth/login",
      "/api/v1/projects",
      "/api/v1/sdm/models",
      "/api/v1/sdm/config/defaults",
      "/api/v1/sdm/run",
      "/api/v1/sdm/batch",
      "/api/v1/sdm/runs",
      "/api/v1/sdm/status/{jobId}",
      "/api/v1/data/occurrences/upload",
      "/api/v1/data/occurrences/clean",
      "/api/v1/results/{id}",
      "/api/v1/results/{id}/manifest",
      "/api/v1/jobs/{jobId}",
    ] as const;

    for (const path of requiredPaths) {
      expect(openApiDocument.paths[path], `missing path: ${path}`).toBeDefined();
    }
  });

  it("defines expected public auth schemes", () => {
    const schemes = openApiDocument.components?.securitySchemes;
    expect(schemes).toBeDefined();
    expect(schemes?.bearerAuth).toEqual(
      expect.objectContaining({
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      })
    );
    expect(schemes?.apiKeyAuth).toEqual(
      expect.objectContaining({
        type: "apiKey",
        name: "X-API-Key",
        in: "header",
      })
    );
    expect(openApiDocument.info.description).toContain("X-Hono-Internal");
  });
});
