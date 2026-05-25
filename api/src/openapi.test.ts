import { describe, expect, it } from "vitest";
import { openApiDocument } from "./openapi.js";

type ObjectSchemaForTest = {
  properties?: Record<string, unknown>;
};

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
      "/api/v1/sdm/batches/{batchId}",
      "/api/v1/sdm/runs",
      "/api/v1/sdm/status/{jobId}",
      "/api/v1/data/occurrence-datasets",
      "/api/v1/data/occurrence-datasets/register",
      "/api/v1/data/occurrence-datasets/{id}",
      "/api/v1/data/occurrences/upload",
      "/api/v1/data/occurrences/clean",
      "/api/v1/climate/download",
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

  it("documents occurrence dataset identity responses", () => {
    const schemas = openApiDocument.components?.schemas;
    expect(schemas?.OccurrenceDataset).toBeDefined();
    expect(schemas?.OccurrenceDatasetListResponse).toBeDefined();

    const uploadSchema = openApiDocument.paths["/api/v1/data/occurrences/upload"].post?.responses["200"].content?.["application/json"].schema;
    expect(uploadSchema as ObjectSchemaForTest).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        dataset_id: expect.objectContaining({ type: "string" }),
      }),
    }));

    const cleanSchema = openApiDocument.paths["/api/v1/data/occurrences/clean"].post?.responses["200"].content?.["application/json"].schema;
    expect(cleanSchema as ObjectSchemaForTest).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        input_dataset_id: expect.objectContaining({ type: "string" }),
        output_dataset_id: expect.objectContaining({ type: "string" }),
      }),
    }));
  });

  it("documents Idempotency-Key on expensive workflow routes", () => {
    const idempotentOperations = [
      openApiDocument.paths["/api/v1/sdm/run"].post,
      openApiDocument.paths["/api/v1/sdm/batch"].post,
      openApiDocument.paths["/api/v1/data/occurrences/clean"].post,
      openApiDocument.paths["/api/v1/climate/download"].post,
    ];

    for (const operation of idempotentOperations) {
      expect(operation?.parameters).toContainEqual(expect.objectContaining({
        name: "Idempotency-Key",
        in: "header",
        required: false,
      }));
      expect(operation?.responses["409"]).toBeDefined();
    }
  });

  it("documents additive batch comparison summaries", () => {
    const schemas = openApiDocument.components?.schemas;
    expect(schemas?.SdmBatchComparison).toBeDefined();
    expect(schemas?.SdmBatchComparisonMetricGroup).toBeDefined();

    const batchStatusSchema = schemas?.SdmBatchStatusResponse as ObjectSchemaForTest;
    expect(batchStatusSchema).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        comparison: expect.objectContaining({ $ref: "#/components/schemas/SdmBatchComparison" }),
      }),
    }));
  });

  it("documents additive SDM workflow status polling fields", () => {
    const schemas = openApiDocument.components?.schemas;
    const runStatusSchema = schemas?.SdmRunStatusResponse as ObjectSchemaForTest;
    expect(runStatusSchema).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        status_schema: expect.objectContaining({ enum: ["workflow_status.v1"] }),
        run_id: expect.objectContaining({ type: "string" }),
        workflow_id: expect.objectContaining({ type: "string" }),
        terminal: expect.objectContaining({ type: "boolean" }),
        progress_percent: expect.objectContaining({ nullable: true }),
        poll_after_ms: expect.objectContaining({ nullable: true }),
      }),
    }));
  });

  it("documents auth on queue job status", () => {
    const operation = openApiDocument.paths["/api/v1/jobs/{jobId}"].get;
    expect(operation?.security).toEqual(openApiDocument.paths["/api/v1/sdm/run"].post?.security);
    expect(operation?.responses["401"]).toBeDefined();
    expect(operation?.description).toContain("visible run");
  });
});
