# SDM Dashboard Agentic API Workflow (Notebook/CLI First)

This is an **early API-first workflow** for scripts/notebooks. It proves the
machine workflow direction before MCP. MCP is intentionally a later adapter
over these API primitives, not part of this flow yet.

All values below use placeholders. Do not paste real keys into docs/notebooks.

## 0) Environment setup

```bash
export SDM_API_BASE="https://<sdm-api-host>"
export SDM_EMAIL="user+demo@example.com"
export SDM_PASSWORD="<strong-password>"
export SDM_API_KEY="<api-key-from-auth-endpoint>"
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

Option A: upload local CSV.

```bash
SOURCE_FILE_ID="$(curl -sS -X POST "$SDM_API_BASE/api/v1/data/occurrences/upload" \
  -H "X-API-Key: $SDM_API_KEY" \
  -F "file=@./data/examples/acacia_mearnsii_standard.csv" | jq -r '.file_id // .file_path')"
```

Option B: reference saved GBIF pull.

```bash
SOURCE_FILE_ID="$(curl -sS -X POST "$SDM_API_BASE/api/v1/data/occurrences/gbif/save" \
  -H "X-API-Key: $SDM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taxon": "Acacia mearnsii",
    "country": "AU",
    "max_records": 5000
  }' | jq -r '.file_id // .file_path')"
```

## 6) Clean occurrences

```bash
CLEANED_FILE_ID="$(curl -sS -X POST "$SDM_API_BASE/api/v1/data/occurrences/clean" \
  -H "X-API-Key: $SDM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "species": "Acacia mearnsii",
    "file_id": "'"$SOURCE_FILE_ID"'",
    "remove_invalid_coordinates": true,
    "drop_duplicates": true
  }' | jq -r '.cleaned_file_id // .file_id // .file_path')"
```

## 7) Start async single run

```bash
RUN_ID="$(curl -sS -X POST "$SDM_API_BASE/api/v1/sdm/run" \
  -H "X-API-Key: $SDM_API_KEY" \
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
  }' | jq -r '.jobId')"
```

## 8) Poll status

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

```bash
curl -sS "$SDM_API_BASE/api/v1/results/$RUN_ID" \
  -H "X-API-Key: $SDM_API_KEY" | jq

curl -sS "$SDM_API_BASE/api/v1/results/$RUN_ID/manifest" \
  -H "X-API-Key: $SDM_API_KEY" | jq
```

## 10) Start batch run

```bash
BATCH_JSON="$(curl -sS -X POST "$SDM_API_BASE/api/v1/sdm/batch" \
  -H "X-API-Key: $SDM_API_KEY" \
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
BATCH_RUN_IDS="$(echo "$BATCH_JSON" | jq -r '.job_ids[]')"
```

## 11) Inspect jobs

```bash
# Run-centric view (recommended for modelling)
curl -sS "$SDM_API_BASE/api/v1/sdm/runs?status=active&limit=50" \
  -H "X-API-Key: $SDM_API_KEY" | jq

# Optional queue-centric view (useful for async cleaning jobs)
curl -sS "$SDM_API_BASE/api/v1/jobs/<queue-job-id>" \
  -H "X-API-Key: $SDM_API_KEY" | jq

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
   call `/api/v1/data/occurrences/clean` and capture `cleaned_file_id`.
   **Gap:** no first-class dataset object with reusable metadata/version IDs across runs.
4. Build model configs for eastern Australia extent:
   `[138,154,-44,-10]`, spatial-block CV, multiple models.
5. Launch batch with `/api/v1/sdm/batch` and poll child runs.
   **Gap:** `batch_id` is not a durable batch resource with its own status endpoint.
6. Triage by AUC:
   fetch each run result and filter `metrics` in notebook code.
   **Gap:** no server-side compare/triage endpoint (for example, `AUC < 0.7`) across a batch.

## API gaps exposed by this example

- Missing workflow-level species/discovery endpoints for agentic pre-run selection.
- Missing durable occurrence dataset resources (versioned IDs + summary metadata).
- Missing durable batch resource and aggregate status/summary endpoints.
- Missing server-side batch comparison/triage filters (AUC/TSS threshold queries).
