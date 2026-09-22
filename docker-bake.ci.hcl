// CI image build matrix — replaces three sequential docker/build-push-action
// steps with one buildx bake invocation that builds all targets in parallel.
// Contract (must stay in sync with .github/workflows/platform-ci.yml):
//   - identical contexts, Dockerfiles, tags, and gha cache scopes as the
//     previous per-image build-push-action steps;
//   - images are loaded into the local docker daemon (--load) so the compose
//     integration stack, Playwright e2e, OpenAPI type contract, and Trivy
//     scans run against the same exact-SHA images;
//   - `sdm-dashboard-*:latest` tags are required by docker-compose.yml.

group "ci" {
  targets = ["plumber", "api", "frontend"]
}

target "plumber" {
  context    = "."
  dockerfile = "plumber/Dockerfile"
  tags       = ["sdm-dashboard-plumber:latest", "sdm-plumber:test"]
  cache-from = ["type=gha,scope=sdm-dashboard-plumber"]
  cache-to   = ["type=gha,mode=max,scope=sdm-dashboard-plumber"]
}

target "api" {
  context    = "."
  dockerfile = "Dockerfile.api"
  tags       = ["sdm-dashboard-api:latest", "sdm-api:test"]
  cache-from = ["type=gha,scope=sdm-dashboard-api"]
  cache-to   = ["type=gha,mode=max,scope=sdm-dashboard-api"]
}

target "frontend" {
  context    = "."
  dockerfile = "Dockerfile.frontend"
  tags       = ["sdm-dashboard-frontend:latest", "sdm-frontend:test"]
  cache-from = ["type=gha,scope=sdm-dashboard-frontend"]
  cache-to   = ["type=gha,mode=max,scope=sdm-dashboard-frontend"]
}