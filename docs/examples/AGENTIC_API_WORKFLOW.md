# SDM Dashboard Agentic API Workflow (Notebook/CLI First)

This is an **API-first workflow** for scripts/notebooks. It exercises the
current machine contracts before MCP exists as a supported adapter. MCP should
remain a later, curated layer over these API primitives; do not claim live MCP
tool support from this example.

All values below use placeholders. Do not paste real keys into docs/notebooks.

The example uses deterministic `Idempotency-Key` values so repeated submissions
can be replayed safely when the request body is identical. Change the workflow
suffix whenever the body changes.

## 0) Environment setup

```bash
export SDM_API_BASE="https://<sdm-api-host>"
export SDM_EMAIL="user+demo@example.com"
export SDM_PASSWORD="<strong-password>"
export SDM_API_KEY="<api-key-from-auth-endpoint>"
export WORKFLOW_TAG="acacia-east-au-v1"
```

## 1) Health check

```bash
curl -sS "$SDM_API_BASE/health" | jq
```

## 2) Register + login (JWT bootstrap)

```bash
# Register (or skip if user already exists)
curl -sS -X POST "$SDM_API_BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "'"$SDM_EMAIL"'",
    "password": "'"$SDM_PASSWORD"'",
    "name": "Notebook Demo User"
  }' | jq

# Login and capture token
JWT_TOKEN="$(curl -sS -X POST "$SDM_API_BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "'"$SDM_EMAIL"'",
    "password": "'"$SDM_PASSWORD"'"
  }' | jq -r '.token')"
```

## 3) Create/list project

```bash
# Create API key for CLI/notebook calls (also bypasses CSRF checks on write endpoints)
SDM_API_KEY="$(curl -sS -X POST "$SDM_API_BASE/api/v1/auth/api-keys" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"notebook-demo-key"}' | jq -r '.key')"

# Create project
PROJECT_ID="$(curl -sS -X POST "$SDM_API_BASE/api/v1/projects" \
  -H "X-API-Key: $SDM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acacia East AU AUC Triage",
    "description": "API-first workflow test"
  }' | jq -r '.id')"

# List projects
curl -sS "$SDM_API_BASE/api/v1/projects" \
  -H "X-API-Key: $SDM_API_KEY" | jq
```

## 4) Inspect model catalog and config defaults

```bash
curl -sS "$SDM_API_BASE/api/v1/sdm/models" \
  -H "X-API-Key: $SDM_API_KEY" | jq

curl -sS "$SDM_API_BASE/api/v1/sdm/config/defaults" \
  -H "X-API-Key: $SDM_API_KEY" | jq
```

## 5) Upload or reference occurrence data

Occurrence upload, saved GBIF, DwCA parse, and synchronous clean responses now
return stable occurrence dataset IDs when the API can attach one. Use those IDs
for lineage and dataset lookup. SDM model submission still takes file IDs/paths
(`occurrenceFile`, `cleanedFilePath`) today, so the example keeps both.

Option A: upload local CSV.

```bash
SOURCE_UPLOAD_JSON="$(curl -sS -X POST "$SDM_API_BASE/api/v1/data/occurrences/upload" \
  -H "X-API-Key: $SDM_API_KEY" \
  -F "project_id=$PROJECT_ID" \
  -F "file=@./data/examples/acacia_mearnsii_standard.csv")"
SOURCE_FILE_ID="$(echo "$SOURCE_UPLOAD_JSON" | jq -r '.file_id // .file_path')"
SOURCE_DATASET_ID="$(echo "$SOURCE_UPLOAD_JSON" | jq -r '.dataset_id')"
```

Option B: reference saved GBIF pull.

```bash
SOURCE_UPLOAD_JSON="$(curl -sS -X POST "$SDM_API_BASE/api/v1/data/occurrences/gbif/save" \
  -H "X-API-Key: $SDM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "'"$PROJECT_ID"'",
    "taxon": "Acacia mearnsii",
    "country": "AU",
    "max_records": 5000
  }')"
SOURCE_FILE_ID="$(echo "$SOURCE_UPLOAD_JSON" | jq -r '.file_id // .file_path')"
SOURCE_DATASET_ID="$(echo "$SOURCE_UPLOAD_JSON" | jq -r '.dataset_id')"
```

List or fetch stable dataset identity. The dataset endpoints are project-scoped
and support filters such as `species_id`, `parent_dataset_id`, `kind`, and
`status`.

```bash
curl -sS "$SDM_API_BASE/api/v1/data/occurrence-datasets?project_id=$PROJECT_ID" \
  -H "X-API-Key: $SDM_API_KEY" | jq

curl -sS "$SDM_API_BASE/api/v1/data/occurrence-datasets/$SOURCE_DATASET_ID?project_id=$PROJECT_ID" \
  -H "X-API-Key: $SDM_API_KEY" | jq
```

## 6) Clean occurrences

```bash
CLEANED_JSON="$(curl -sS -X POST "$SDM_API_BASE/api/v1/data/occurrences/clean" \
  -H "X-API-Key: $SDM_API_KEY" \
  -H "Idempotency-Key: clean-$WORKFLOW_TAG" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "'"$PROJECT_ID"'",
    "dataset_id": "'"$SOURCE_DATASET_ID"'",
    "species": "Acacia mearnsii",
    "file_id": "'"$SOURCE_FILE_ID"'",
    "remove_invalid_coordinates": true,
    "drop_duplicates": true
  }')"
CLEANED_FILE_ID="$(echo "$CLEANED_JSON" | jq -r '.cleaned_file_id // .file_id // .file_path')"
CLEANED_DATASET_ID="$(echo "$CLEANED_JSON" | jq -r '.output_dataset_id')"

curl -sS "$SDM_API_BASE/api/v1/data/occurrence-datasets/$CLEANED_DATASET_ID?project_id=$PROJECT_ID" \
  -H "X-API-Key: $SDM_API_KEY" | jq
```

Optional async clean jobs return a queue job ID. Poll those with the normalized
generic jobs contract:

```bash
CLEAN_JOB_ID="$(curl -sS -X POST "$SDM_API_BASE/api/v1/data/occurrences/clean" \
  -H "X-API-Key: $SDM_API_KEY" \
  -H "Idempotency-Key: clean-async-$WORKFLOW_TAG" \
  -H "Content-Type: application/json" \
  -d '{
    "async": true,
    "project_id": "'"$PROJECT_ID"'",
    "dataset_id": "'"$SOURCE_DATASET_ID"'",
    "species": "Acacia mearnsii",
    "file_id": "'"$SOURCE_FILE_ID"'",
    "remove_invalid_coordinates": true,
    "drop_duplicates": true
  }' | jq -r '.jobId')"

while true; do
  JOB_JSON="$(curl -sS "$SDM_API_BASE/api/v1/jobs/$CLEAN_JOB_ID" \
    -H "X-API-Key: $SDM_API_KEY")"
  echo "$JOB_JSON" | jq '{id,state,status,progress,progress_percent,terminal,poll_after_ms,error}'

  if [ "$(echo "$JOB_JSON" | jq -r '.terminal')" = "true" ]; then
    echo "$JOB_JSON" | jq
    break
  fi

  sleep "$(echo "$JOB_JSON" | jq -r '(.poll_after_ms // 2000) / 1000')"
done
```

## 7) Start async single run

```bash
RUN_START_JSON="$(curl -sS -X POST "$SDM_API_BASE/api/v1/sdm/run" \
  -H "X-API-Key: $SDM_API_KEY" \
  -H "Idempotency-Key: run-glm-$WORKFLOW_TAG" \
  -H "Content-Type: application/json" \
  -d '{
    "async": true,
    "species": "Acacia mearnsii",
    "modelId": "glm",
    "occurrenceFile": "'"$SOURCE_FILE_ID"'",
    "cleanedFilePath": "'"$CLEANED_FILE_ID"'",
    "biovars": [1,4,6,12,15,18],
    "projectionExtent": [138,154,-44,-10],
    "backgroundN": 10000,
    "cvFolds": 5,
    "cvStrategy": "spatial_blocks",
    "cvBlockSizeKm": 100,
    "threshold": 0.5,
    "nCores": 2,
    "seed": 42
  }')"

echo "$RUN_START_JSON" | jq
RUN_ID="$(echo "$RUN_START_JSON" | jq -r '.jobId // .runId')"
```

## 8) Poll status

For async SDM model runs, `POST /api/v1/sdm/run` currently returns the run ID
as `jobId`. Poll `/api/v1/sdm/status/:runId` for run-centric status. The
normalized `/api/v1/jobs/:jobId` fields shown above apply to queue-backed job
IDs, not every SDM run ID yet.

```bash
while true; do
  STATUS_JSON="$(curl -sS "$SDM_API_BASE/api/v1/sdm/status/$RUN_ID" \
    -H "X-API-Key: $SDM_API_KEY")"
  STATUS="$(echo "$STATUS_JSON" | jq -r '.status')"
  echo "run=$RUN_ID status=$STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then
    echo "$STATUS_JSON" | jq
    break
  fi
  sleep 5
done
```

## 9) Fetch result summary and manifest

The manifest route normalizes Plumber output into `run_manifest.v1` at the Hono
API boundary while preserving compatibility fields such as `ok`,
`manifest_path`, and `manifest.run_id`.

```bash
curl -sS "$SDM_API_BASE/api/v1/results/$RUN_ID" \
  -H "X-API-Key: $SDM_API_KEY" | jq

curl -sS "$SDM_API_BASE/api/v1/results/$RUN_ID/manifest" \
  -H "X-API-Key: $SDM_API_KEY" \
  | jq '{
      ok,
      schema_version,
      run_id,
      manifest_path,
      model: .manifest.model,
      data: .manifest.data,
      climate: .manifest.climate,
      validation: .manifest.validation,
      metrics: .manifest.metrics,
      artifacts: .manifest.artifacts
    }'
```

## 10) Start batch run

```bash
BATCH_JSON="$(curl -sS -X POST "$SDM_API_BASE/api/v1/sdm/batch" \
  -H "X-API-Key: $SDM_API_KEY" \
  -H "Idempotency-Key: batch-$WORKFLOW_TAG" \
  -H "Content-Type: application/json" \
  -d '{
    "parallel": 2,
    "configs": [
      {
        "species": "Acacia mearnsii",
        "modelId": "glm",
        "occurrenceFile": "'"$SOURCE_FILE_ID"'",
        "cleanedFilePath": "'"$CLEANED_FILE_ID"'",
        "biovars": [1,4,6,12,15,18],
        "projectionExtent": [138,154,-44,-10]
      },
      {
        "species": "Acacia mearnsii",
        "modelId": "maxnet",
        "occurrenceFile": "'"$SOURCE_FILE_ID"'",
        "cleanedFilePath": "'"$CLEANED_FILE_ID"'",
        "biovars": [1,4,6,12,15,18],
        "projectionExtent": [138,154,-44,-10]
      }
    ]
  }')"

echo "$BATCH_JSON" | jq
BATCH_ID="$(echo "$BATCH_JSON" | jq -r '.batch_id')"
BATCH_RUN_IDS="$(echo "$BATCH_JSON" | jq -r '.job_ids[]')"
```

## 11) Inspect batch status and comparison

`GET /api/v1/sdm/batches/:batchId` returns aggregate status plus an additive
`comparison` object with schema `batch_comparison.v1`. The comparison is
bounded to numeric scalar metrics and warnings; it intentionally omits raw
rasters, occurrence rows, and output files.

```bash
# Run-centric view (recommended for modelling)
curl -sS "$SDM_API_BASE/api/v1/sdm/runs?status=active&limit=50" \
  -H "X-API-Key: $SDM_API_KEY" | jq

# Batch aggregate view with comparison summary
BATCH_STATUS_JSON="$(curl -sS "$SDM_API_BASE/api/v1/sdm/batches/$BATCH_ID" \
  -H "X-API-Key: $SDM_API_KEY")"

echo "$BATCH_STATUS_JSON" | jq '{
  batch_id,
  total,
  counts_by_status,
  active,
  completed,
  failed,
  cancelled,
  latest_error,
  comparison_schema: .comparison.schema,
  comparison_counts: .comparison.counts,
  warnings: .comparison.warnings
}'

echo "$BATCH_STATUS_JSON" | jq '.comparison.metrics.by_run'
echo "$BATCH_STATUS_JSON" | jq '.comparison.metrics.by_species'
echo "$BATCH_STATUS_JSON" | jq '.comparison.metrics.by_model'

# Inspect each batch child run directly
for RID in $BATCH_RUN_IDS; do
  curl -sS "$SDM_API_BASE/api/v1/sdm/status/$RID" \
    -H "X-API-Key: $SDM_API_KEY" | jq '{id,status,error,metrics}'
done
```

## Acacia / Eastern Australia / AUC triage pseudo-workflow

1. Resolve species target:
   `Acacia mearnsii` from a notebook-side species list.
   **Gap:** no high-level `/species/search-candidates` endpoint yet.
2. Pull occurrence source:
   use upload or `gbif/save` with AU scope.
   **Gap:** no server endpoint for richer discovery filters (state/region, basisOfRecord, coordinate uncertainty buckets) before file creation.
3. Clean and standardize occurrences:
   call `/api/v1/data/occurrences/clean` and capture both `cleaned_file_id`
   and `output_dataset_id`.
   **Remaining gap:** dataset previews/summaries are currently metadata-only; richer
   server-side discovery and QA filters still need workflow endpoints.
4. Build model configs for eastern Australia extent:
   `[138,154,-44,-10]`, spatial-block CV, multiple models.
5. Launch batch with `/api/v1/sdm/batch` and poll
   `/api/v1/sdm/batches/{batch_id}` for aggregate status.
6. Triage by AUC:
   read `comparison.metrics.by_run`, `comparison.metrics.by_species`, and
   `comparison.metrics.by_model` from the batch response.
   **Remaining gap:** the API has a bounded comparison summary, but no
   server-side compare/triage filter endpoint yet (for example, `AUC < 0.7`
   across a batch).
7. Fetch final artifacts deliberately:
   use `/api/v1/results/{run_id}/manifest` for `run_manifest.v1` summaries and
   explicit file/report endpoints when the workflow needs downloads.

## API gaps exposed by this example

- Missing workflow-level species/discovery endpoints for agentic pre-run selection.
- Occurrence dataset IDs are stable, but SDM model configs still require
  file/path inputs instead of dataset IDs as canonical inputs.
- `GET /api/v1/jobs/:jobId` has normalized queue polling fields, but SDM run,
  batch, climate proxy, and Plumber pass-through status shapes are not yet one
  normalized workflow resource.
- Batch responses include `batch_comparison.v1`, but there is no server-side
  comparison/triage filter endpoint yet (AUC/TSS threshold queries).
- `run_manifest.v1` is normalized for individual runs; there is no batch
  manifest contract yet.
- MCP remains a future adapter boundary. Current docs should map prospective
  MCP tools to these API calls, not imply the MCP tools are live.
