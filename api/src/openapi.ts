type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type ReferenceObject = {
  $ref: string;
};

type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  format?: string;
  enum?: readonly (string | number | boolean)[];
  allOf?: readonly (JsonSchema | ReferenceObject)[];
  items?: JsonSchema | ReferenceObject;
  properties?: Record<string, JsonSchema | ReferenceObject>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema | ReferenceObject;
  nullable?: boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

type ParameterObject = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema: JsonSchema | ReferenceObject;
};

type MediaTypeObject = {
  schema: JsonSchema | ReferenceObject;
};

type RequestBodyObject = {
  required?: boolean;
  description?: string;
  content: Record<string, MediaTypeObject>;
};

type ResponseObject = {
  description: string;
  content?: Record<string, MediaTypeObject>;
};

type OperationObject = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: readonly string[];
  security?: SecurityRequirementObject[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
};

type PathItemObject = Partial<Record<HttpMethod, OperationObject>>;

type SecurityRequirementObject = Record<string, string[]>;

type SecuritySchemeObject = {
  type: "http" | "apiKey";
  description?: string;
  scheme?: string;
  bearerFormat?: string;
  name?: string;
  in?: "header" | "query" | "cookie";
};

type OpenApiDocument = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, PathItemObject>;
  components?: {
    securitySchemes?: Record<string, SecuritySchemeObject>;
    schemas?: Record<string, JsonSchema>;
  };
};

const errorResponse: ResponseObject = {
  description: "Error response",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
};

const bearerOrApiKeySecurity: SecurityRequirementObject[] = [
  { bearerAuth: [] },
  { apiKeyAuth: [] },
];

const idempotencyKeyParameter: ParameterObject = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "Optional client-generated key for expensive or mutating POST requests. Reusing the same key with the same route, scope, and request body replays the stored response; reusing it with a different body returns 409.",
  schema: { type: "string" },
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "SDM Dashboard API",
    version: "0.1.0",
    description:
      "Baseline machine-readable contract for core SDM Dashboard routes. " +
      "Internal Plumber service key header `X-Hono-Internal` is reserved for service-to-service calls and is not part of the public client authentication schemes.",
  },
  paths: {
    "/health": {
      get: {
        operationId: "healthCheck",
        summary: "Health check",
        tags: ["system"],
        security: [],
        responses: {
          "200": {
            description: "Service health",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/ready": {
      get: {
        operationId: "readinessCheck",
        summary: "Readiness check",
        tags: ["system"],
        security: [],
        responses: {
          "200": {
            description: "Ready",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReadyResponse" },
              },
            },
          },
          "503": {
            description: "Degraded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReadyResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/auth/register": {
      post: {
        operationId: "register",
        summary: "Register account",
        tags: ["auth"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "User registered",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
          "400": errorResponse,
          "409": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        operationId: "login",
        summary: "Login",
        tags: ["auth"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "User authenticated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/projects": {
      get: {
        operationId: "listProjects",
        summary: "List projects",
        tags: ["projects"],
        security: bearerOrApiKeySecurity,
        responses: {
          "200": {
            description: "Projects visible to current user",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Project" },
                },
              },
            },
          },
          "401": errorResponse,
        },
      },
      post: {
        operationId: "createProject",
        summary: "Create project",
        tags: ["projects"],
        security: bearerOrApiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  description: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Project created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Project" },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
        },
      },
    },
    "/api/v1/sdm/models": {
      get: {
        operationId: "listSdmModels",
        summary: "List supported SDM models",
        tags: ["sdm"],
        responses: {
          "200": {
            description: "Model catalog",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/SdmModel" },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/sdm/config/defaults": {
      get: {
        operationId: "getSdmDefaults",
        summary: "Get default SDM configuration",
        tags: ["sdm"],
        responses: {
          "200": {
            description: "Default SDM configuration",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SdmConfigDefaults" },
              },
            },
          },
        },
      },
    },
    "/api/v1/sdm/run": {
      post: {
        operationId: "runSdmModel",
        summary: "Run SDM model",
        tags: ["sdm"],
        security: bearerOrApiKeySecurity,
        parameters: [idempotencyKeyParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                allOf: [{ $ref: "#/components/schemas/SdmModelConfig" }],
                type: "object",
                properties: {
                  async: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Run started",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SdmRunStartResponse" },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "409": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/v1/sdm/batch": {
      post: {
        operationId: "runSdmBatch",
        summary: "Run batch SDM jobs",
        tags: ["sdm"],
        security: bearerOrApiKeySecurity,
        parameters: [idempotencyKeyParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SdmBatchRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Batch started",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SdmBatchResponse" },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "409": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/sdm/batches/{batchId}": {
      get: {
        operationId: "getSdmBatchStatus",
        summary: "Get aggregate SDM batch status",
        tags: ["sdm"],
        security: bearerOrApiKeySecurity,
        parameters: [
          {
            name: "batchId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Batch aggregate status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SdmBatchStatusResponse" },
              },
            },
          },
          "401": errorResponse,
          "404": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/v1/sdm/runs": {
      get: {
        operationId: "listSdmRuns",
        summary: "List SDM runs",
        tags: ["sdm"],
        security: bearerOrApiKeySecurity,
        responses: {
          "200": {
            description: "Paginated runs",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SdmRunsResponse" },
              },
            },
          },
          "401": errorResponse,
        },
      },
    },
    "/api/v1/sdm/status/{jobId}": {
      get: {
        operationId: "getSdmStatus",
        summary: "Get SDM run status",
        tags: ["sdm"],
        security: bearerOrApiKeySecurity,
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Run status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SdmRunStatusResponse" },
              },
            },
          },
          "401": errorResponse,
          "404": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/v1/data/occurrence-datasets": {
      get: {
        operationId: "listOccurrenceDatasets",
        summary: "List occurrence datasets",
        tags: ["data"],
        security: bearerOrApiKeySecurity,
        parameters: [
          {
            name: "project_id",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "species_id",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "parent_dataset_id",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "kind",
            in: "query",
            schema: { type: "string", enum: ["upload", "gbif", "dwca", "cleaned", "registered"] },
          },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["pending", "ready", "failed"] },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 500, default: 50 },
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", minimum: 0, default: 0 },
          },
        ],
        responses: {
          "200": {
            description: "Occurrence datasets visible in the selected project",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OccurrenceDatasetListResponse" },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/data/occurrence-datasets/register": {
      post: {
        operationId: "registerOccurrenceDataset",
        summary: "Register existing occurrence file as a dataset",
        tags: ["data"],
        security: bearerOrApiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "Provide either file_id or file_path.",
                properties: {
                  file_id: { type: "string" },
                  file_path: { type: "string" },
                  project_id: { type: "string" },
                  species_id: { type: "string", nullable: true },
                  parent_dataset_id: { type: "string", nullable: true },
                  kind: { type: "string", enum: ["upload", "gbif", "dwca", "cleaned", "registered"], default: "registered" },
                  status: { type: "string", enum: ["pending", "ready", "failed"], default: "ready" },
                  file_name: { type: "string", nullable: true },
                  record_count: { type: "integer", nullable: true },
                  valid_count: { type: "integer", nullable: true },
                  summary: { type: "object", nullable: true, additionalProperties: true },
                  metadata: { type: "object", nullable: true, additionalProperties: true },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Registered occurrence dataset",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OccurrenceDataset" },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/data/occurrence-datasets/{id}": {
      get: {
        operationId: "getOccurrenceDataset",
        summary: "Get occurrence dataset",
        tags: ["data"],
        security: bearerOrApiKeySecurity,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "project_id",
            in: "query",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Occurrence dataset",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OccurrenceDataset" },
              },
            },
          },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/data/occurrences/upload": {
      post: {
        operationId: "uploadOccurrences",
        summary: "Upload occurrence file",
        tags: ["data"],
        security: bearerOrApiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Occurrence upload accepted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    file_id: { type: "string" },
                    file_path: { type: "string" },
                    dataset_id: { type: "string", description: "Stable occurrence dataset id when a file id/path is produced" },
                    n_rows: { type: "integer" },
                    filename: { type: "string" },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "413": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/v1/data/occurrences/clean": {
      post: {
        operationId: "cleanOccurrences",
        summary: "Clean occurrence data",
        tags: ["data"],
        security: bearerOrApiKeySecurity,
        parameters: [idempotencyKeyParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["file_id", "species"],
                properties: {
                  file_id: { type: "string", description: "Occurrence CSV file id/path" },
                  dataset_id: { type: "string", description: "Existing input occurrence dataset id", nullable: true },
                  project_id: { type: "string", nullable: true },
                  species: { type: "string" },
                  async: { type: "boolean", default: false },
                },
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Cleaning result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    input_dataset_id: { type: "string", nullable: true },
                    output_dataset_id: { type: "string", nullable: true },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
          "401": errorResponse,
          "409": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/v1/climate/download": {
      post: {
        operationId: "downloadClimate",
        summary: "Queue climate data download",
        tags: ["climate"],
        security: bearerOrApiKeySecurity,
        parameters: [idempotencyKeyParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["cmip6", "cmip6_average", "worldclim", "chelsa"], default: "cmip6" },
                  gcm_list: { type: "array", items: { type: "string" }, nullable: true },
                },
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Climate download queued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    jobId: { type: "string" },
                    status: { type: "string", enum: ["queued"] },
                  },
                  required: ["jobId", "status"],
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "409": errorResponse,
          "503": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/v1/results/{id}": {
      get: {
        operationId: "getResultById",
        summary: "Get result summary",
        tags: ["results"],
        security: bearerOrApiKeySecurity,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Run result summary",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SdmRunStatusResponse" },
              },
            },
          },
          "401": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/api/v1/results/{id}/manifest": {
      get: {
        operationId: "getResultManifest",
        summary: "Get run output manifest",
        tags: ["results"],
        security: bearerOrApiKeySecurity,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Manifest content from Plumber",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          },
          "401": errorResponse,
          "404": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/v1/jobs/{jobId}": {
      get: {
        operationId: "getQueueJobStatus",
        summary: "Get queue job status",
        description:
          "BullMQ queue status endpoint. Currently exposed without public auth middleware in this API slice.",
        tags: ["jobs"],
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Queue job status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          },
          "404": errorResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT bearer token from /api/v1/auth/login or /api/v1/auth/register.",
      },
      apiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "User-issued API key from /api/v1/auth/api-keys endpoints.",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
        required: ["error"],
      },
      HealthResponse: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok"] },
          timestamp: { type: "string", format: "date-time" },
          services: {
            type: "object",
            properties: {
              plumber: { type: "string" },
              redis: { type: "string" },
            },
          },
        },
        required: ["status", "timestamp", "services"],
      },
      ReadyResponse: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ready", "degraded"] },
          checks: {
            type: "object",
            properties: {
              plumber: { type: "boolean" },
              database: { type: "boolean" },
              storage: { type: "boolean" },
            },
          },
        },
        required: ["status", "checks"],
      },
      AuthUser: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          name: { type: "string", nullable: true },
          role: { type: "string" },
        },
        required: ["id", "email", "role"],
      },
      AuthResponse: {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/AuthUser" },
          token: { type: "string" },
        },
        required: ["user", "token"],
      },
      Project: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          role: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time", nullable: true },
        },
        required: ["id", "name"],
      },
      OccurrenceDataset: {
        type: "object",
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          speciesId: { type: "string", nullable: true },
          parentDatasetId: { type: "string", nullable: true },
          kind: { type: "string", enum: ["upload", "gbif", "dwca", "cleaned", "registered"] },
          status: { type: "string", enum: ["pending", "ready", "failed"] },
          fileId: { type: "string" },
          fileName: { type: "string", nullable: true },
          recordCount: { type: "integer", nullable: true },
          validCount: { type: "integer", nullable: true },
          summary: { type: "object", nullable: true, additionalProperties: true },
          metadata: { type: "object", nullable: true, additionalProperties: true },
          createdBy: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "projectId", "kind", "status", "fileId"],
      },
      OccurrenceDatasetListResponse: {
        type: "object",
        properties: {
          occurrence_datasets: {
            type: "array",
            items: { $ref: "#/components/schemas/OccurrenceDataset" },
          },
          limit: { type: "integer" },
          offset: { type: "integer" },
          hasMore: { type: "boolean" },
        },
        required: ["occurrence_datasets", "limit", "offset", "hasMore"],
      },
      SdmModel: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          maturity: { type: "string", enum: ["stable", "experimental", "deprecated"] },
          min_records: { type: "integer", nullable: true },
          available: { type: "boolean" },
          notes: { type: "string", nullable: true },
        },
        required: ["id", "label", "maturity", "available"],
      },
      SdmConfigDefaults: {
        type: "object",
        properties: {
          biovars: {
            type: "array",
            items: { type: "integer", minimum: 1, maximum: 19 },
          },
          backgroundN: { type: "integer" },
          cvFolds: { type: "integer" },
          cvStrategy: { type: "string", enum: ["random", "spatial_blocks"] },
          threshold: { type: "number" },
          nCores: { type: "integer" },
          seed: { type: "integer" },
          extentPresets: {
            type: "object",
            additionalProperties: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: { type: "number" },
            },
          },
        },
      },
      SdmModelConfig: {
        type: "object",
        description: "Handcrafted mirror of @sdm/shared modelConfigSchema for machine clients.",
        required: ["species", "modelId", "biovars", "projectionExtent", "occurrenceFile"],
        properties: {
          species: { type: "string" },
          modelId: { type: "string" },
          biovars: {
            type: "array",
            minItems: 2,
            items: { type: "integer", minimum: 1, maximum: 19 },
          },
          projectionExtent: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: { type: "number" },
          },
          backgroundN: { type: "integer", minimum: 500, maximum: 100000, default: 10000 },
          cvFolds: { type: "integer", minimum: 0, maximum: 10, default: 3 },
          cvStrategy: { type: "string", enum: ["random", "spatial_blocks"], default: "random" },
          cvBlockSizeKm: { type: "number", minimum: 1, maximum: 500, nullable: true },
          threshold: { type: "number", minimum: 0.05, maximum: 0.95, default: 0.5 },
          includeQuadratic: { type: "boolean", default: true },
          useElevation: { type: "boolean", default: false },
          elevationDemtype: { type: "string", default: "COP90" },
          opentopoApiKey: { type: "string", nullable: true },
          useSoil: { type: "boolean", default: false },
          soilVars: { type: "array", items: { type: "string" } },
          soilDepths: { type: "array", items: { type: "string" } },
          useUv: { type: "boolean", default: false },
          uvVars: { type: "array", items: { type: "string" } },
          useVegetation: { type: "boolean", default: false },
          vegYear: { type: "integer", nullable: true },
          vegProducts: { type: "array", items: { type: "string" } },
          useLulc: { type: "boolean", default: false },
          lulcYear: { type: "integer", default: 2020 },
          useHfp: { type: "boolean", default: false },
          hfpYear: { type: "integer", default: 2020 },
          useBioclimSeason: { type: "boolean", default: false },
          useDrought: { type: "boolean", default: false },
          futureProjection: { type: "boolean", default: false },
          futureWorldclimDir: { type: "string", nullable: true },
          futureLabel: { type: "string", default: "Future climate" },
          vifReduction: { type: "boolean", default: false },
          vifThreshold: { type: "number", minimum: 1, maximum: 20, default: 10 },
          climateMatching: { type: "boolean", default: false },
          climateMatchingMethod: { type: "string", enum: ["mahalanobis", "standardised", "euclidean"], default: "mahalanobis" },
          thinByCell: { type: "boolean", default: true },
          mergeSmallSources: { type: "boolean", default: true },
          minSourceRecords: { type: "integer", minimum: 1, maximum: 100, default: 15 },
          biasMethod: { type: "string", enum: ["uniform", "target_group", "thickened"], default: "uniform" },
          thickeningDistanceKm: { type: "number", minimum: 1, maximum: 100, default: 10 },
          paReplicates: { type: "integer", minimum: 1, maximum: 10, default: 1 },
          maxnetFeatures: { type: "string", enum: ["l", "lq", "lqp", "lqh", "lqpht"], default: "lqp" },
          maxnetRegmult: { type: "number", minimum: 0.1, maximum: 10, default: 1.0 },
          aggregationFactor: { type: "integer", minimum: 1, maximum: 8, default: 1 },
          nCores: { type: "integer", minimum: 1, maximum: 64, default: 1 },
          seed: { type: "integer", default: 42 },
          occurrenceFile: { type: "string" },
          cleanedFilePath: { type: "string", nullable: true },
          worldclimDir: { type: "string", default: "Worldclim" },
          worldclimRes: { type: "number", default: 10 },
          source: { type: "string", enum: ["worldclim", "chelsa"], default: "worldclim" },
          chelsaExtras: { type: "array", items: { type: "string" } },
        },
      },
      SdmRunStartResponse: {
        type: "object",
        properties: {
          runId: { type: "string", nullable: true },
          jobId: { type: "string", nullable: true },
          queuedAt: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", nullable: true },
          message: { type: "string", nullable: true },
        },
      },
      SdmBatchRequest: {
        type: "object",
        required: ["configs"],
        properties: {
          configs: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/SdmModelConfig" },
          },
          parallel: { type: "integer", minimum: 1 },
        },
      },
      SdmBatchResponse: {
        type: "object",
        properties: {
          batch_id: { type: "string" },
          job_ids: { type: "array", items: { type: "string" } },
          total: { type: "integer" },
          message: { type: "string" },
        },
      },
      SdmBatchRunSummary: {
        type: "object",
        properties: {
          id: { type: "string" },
          species: { type: "string", nullable: true },
          model_id: { type: "string", nullable: true },
          status: { type: "string" },
          started_at: { type: "string", format: "date-time", nullable: true },
          completed_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time" },
          error: { type: "string", nullable: true },
        },
        required: ["id", "status", "created_at"],
      },
      SdmBatchStatusResponse: {
        type: "object",
        properties: {
          batch_id: { type: "string" },
          total: { type: "integer" },
          counts_by_status: {
            type: "object",
            properties: {
              queued: { type: "integer" },
              running: { type: "integer" },
              completed: { type: "integer" },
              failed: { type: "integer" },
              cancelled: { type: "integer" },
            },
            required: ["queued", "running", "completed", "failed", "cancelled"],
          },
          active: { type: "integer" },
          completed: { type: "integer" },
          failed: { type: "integer" },
          cancelled: { type: "integer" },
          runs: {
            type: "array",
            items: { $ref: "#/components/schemas/SdmBatchRunSummary" },
          },
          created_at: { type: "string", format: "date-time", nullable: true },
          started_at: { type: "string", format: "date-time", nullable: true },
          completed_at: { type: "string", format: "date-time", nullable: true },
          latest_error: { type: "string", nullable: true },
          warnings: { type: "array", items: { type: "string" } },
        },
        required: [
          "batch_id",
          "total",
          "counts_by_status",
          "active",
          "completed",
          "failed",
          "cancelled",
          "runs",
        ],
      },
      SdmRunStatusResponse: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          species: { type: "string", nullable: true },
          model_id: { type: "string", nullable: true },
          started_at: { type: "string", format: "date-time", nullable: true },
          completed_at: { type: "string", format: "date-time", nullable: true },
          error: { type: "string", nullable: true },
          metrics: { type: "object", nullable: true, additionalProperties: true },
          output_files: { type: "object", nullable: true, additionalProperties: true },
          progress_log: { type: "array", items: { type: "string" } },
          config: { type: "object", nullable: true, additionalProperties: true },
        },
      },
      SdmRunsResponse: {
        type: "object",
        properties: {
          runs: {
            type: "array",
            items: { $ref: "#/components/schemas/SdmRunStatusResponse" },
          },
          pagination: {
            type: "object",
            properties: {
              page: { type: "integer" },
              limit: { type: "integer" },
              total: { type: "integer" },
              totalPages: { type: "integer" },
            },
            required: ["page", "limit", "total", "totalPages"],
          },
        },
      },
    },
  },
} as const satisfies OpenApiDocument;
