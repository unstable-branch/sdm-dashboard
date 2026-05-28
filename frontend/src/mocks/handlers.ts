import { http, HttpResponse } from "msw";

const API_BASE = "http://localhost:4000";

interface HandlerConfig {
  simulateDelay?: boolean;
  simulateErrors?: boolean;
  baseDelay?: number;
}

const defaultConfig: HandlerConfig = {
  simulateDelay: false,
  simulateErrors: false,
  baseDelay: 100,
};

let activeConfig = { ...defaultConfig };

export function configureHandlers(config: Partial<HandlerConfig>) {
  activeConfig = { ...activeConfig, ...config };
}

export function resetHandlersConfig() {
  activeConfig = { ...defaultConfig };
}

function delay(path: string) {
  if (!activeConfig.simulateDelay) return 0;
  const delays: Record<string, number> = {
    "/api/v1/admin/overview": activeConfig.baseDelay ?? 100,
    "/api/v1/admin/users": activeConfig.baseDelay ? activeConfig.baseDelay * 2 : 200,
    "/api/v1/admin/logs": activeConfig.baseDelay ? activeConfig.baseDelay * 2 : 200,
    default: activeConfig.baseDelay ?? 100,
  };
  const match = Object.keys(delays).find((k) => path.includes(k));
  return match ? delays[match as keyof typeof delays] : delays.default;
}

export function getHandlers() {
  return [
    http.get(`${API_BASE}/health`, async () => {
      return HttpResponse.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        services: { plumber: "connected", redis: "connected" },
      });
    }),

    http.get(`${API_BASE}/api/v1/admin/overview`, async () => {
      await new Promise((r) => setTimeout(r, delay("overview")));
      if (activeConfig.simulateErrors && Math.random() < 0.1) {
        return HttpResponse.json({ error: "Internal server error" }, { status: 500 });
      }
      return HttpResponse.json({
        counts: { users: 5, runs: 23, occurrences: 1200, species: 8, projects: 3, activeRuns: 1 },
        recentActivity: [
          { id: "a1", action: "user_login", entity: "users", createdAt: new Date().toISOString() },
          { id: "a2", action: "model_run_start", entity: "runs", createdAt: new Date(Date.now() - 60000).toISOString() },
        ],
      });
    }),

    http.get(`${API_BASE}/api/v1/admin/users`, async ({ request: _request }) => {
      const url = new URL(_request.url);
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = parseInt(url.searchParams.get("limit") || "25");
      await new Promise((r) => setTimeout(r, delay("users")));
      return HttpResponse.json({
        users: [
          { id: "u1", email: "[EMAIL]", name: "Admin", role: "admin", lastLoginAt: new Date().toISOString(), createdAt: "2024-01-01T00:00:00Z" },
          { id: "u2", email: "[EMAIL]", name: "Editor", role: "editor", lastLoginAt: null, createdAt: "2024-02-01T00:00:00Z" },
          { id: "u3", email: "[EMAIL]", name: "Viewer", role: "viewer", lastLoginAt: null, createdAt: "2024-03-01T00:00:00Z" },
        ],
        total: 3,
        page,
        limit,
      });
    }),

    http.post(`${API_BASE}/api/v1/admin/users`, async ({ request: _request }) => {
      const body = await _request.json() as Record<string, unknown>;
      return HttpResponse.json({
        id: "u-new",
        email: body.email,
        name: body.name,
        role: body.role || "viewer",
      }, { status: 201 });
    }),

    http.put(`${API_BASE}/api/v1/admin/users/:id`, async ({ params }) => {
      return HttpResponse.json({ id: params.id, email: "[EMAIL]", name: "Updated", role: "editor" });
    }),

    http.delete(`${API_BASE}/api/v1/admin/users/:id`, async () => {
      return HttpResponse.json({ ok: true });
    }),

    http.post(`${API_BASE}/api/v1/admin/users/:id/reset-password`, async () => {
      return HttpResponse.json({ ok: true });
    }),

    http.get(`${API_BASE}/api/v1/admin/logs`, async ({ request: _request }) => {
      const url = new URL(_request.url);
      await new Promise((r) => setTimeout(r, delay("logs")));
      return HttpResponse.json({
        logs: [
          { id: "l1", userId: "u1", action: url.searchParams.get("action") || "user_login", entity: "users", ipAddress: "127.0.0.1", createdAt: new Date().toISOString() },
        ],
        total: 1,
        page: 1,
        limit: 50,
      });
    }),

    http.get(`${API_BASE}/api/v1/admin/logs/actions`, async () => {
      return HttpResponse.json([
        { action: "user_login", count: 10 },
        { action: "model_run_start", count: 5 },
      ]);
    }),

    http.get(`${API_BASE}/api/v1/admin/database/tables`, async () => {
      return HttpResponse.json([
        { schemaname: "public", tablename: "users", size: "96 kB", estimated_rows: 5 },
        { schemaname: "public", tablename: "runs", size: "128 kB", estimated_rows: 23 },
      ]);
    }),

    http.get(`${API_BASE}/api/v1/admin/database/:table`, async ({ params }) => {
      const tableName = params.table as string;
      return HttpResponse.json({
        table: tableName,
        columns: [{ column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" }],
        rows: [{ id: "sample-id" }],
        total: 1,
        page: 1,
        limit: 50,
      });
    }),

    http.get(`${API_BASE}/api/v1/admin/database/:table/stats`, async ({ params }) => {
      return HttpResponse.json({
        table: params.table,
        indexes: [{ indexname: "idx_test", indexdef: "CREATE INDEX idx_test ON test (col)" }],
        constraints: [],
        size: "16 kB",
      });
    }),

    http.get(`${API_BASE}/api/v1/admin/system/settings`, async () => {
      return HttpResponse.json([
        { id: "s1", key: "site_name", value: "SDM Workbench", description: "Display name", updatedAt: new Date().toISOString() },
        { id: "s2", key: "maintenance_mode", value: false, description: "Maintenance toggle", updatedAt: new Date().toISOString() },
        { id: "s3", key: "jwt_expiry_seconds", value: "86400", description: "JWT expiry", updatedAt: new Date().toISOString() },
        { id: "s4", key: "default_climate_source", value: "worldclim", description: "Climate source", updatedAt: new Date().toISOString() },
        { id: "s5", key: "default_model", value: "glm", description: "Default model", updatedAt: new Date().toISOString() },
      ]);
    }),

    http.put(`${API_BASE}/api/v1/admin/system/settings`, async ({ request: _request }) => {
      const body = await _request.json() as Record<string, unknown>;
      return HttpResponse.json({
        id: "s1",
        key: body.key,
        value: body.value,
        description: "Updated",
        updatedAt: new Date().toISOString(),
      });
    }),

    http.post(`${API_BASE}/api/v1/admin/system/cache/clear`, async () => {
      return HttpResponse.json({ ok: true, message: "Cache cleared" });
    }),

    http.post(`${API_BASE}/api/v1/admin/system/jobs/cleanup`, async () => {
      return HttpResponse.json({ ok: true, message: "Found 2 stale jobs", staleJobs: 2 });
    }),

    http.get(`${API_BASE}/api/v1/admin/diagnostics/runs`, async ({ __request }) => {
      return HttpResponse.json({
        runs: [
          { id: "r1", speciesName: "Test species", modelId: "glm", status: "completed", jobId: "j1", error: null, startedAt: null, completedAt: null, createdAt: new Date().toISOString() },
          { id: "r2", speciesName: "Failed run", modelId: "rf", status: "failed", jobId: "j2", error: "Out of memory", startedAt: null, completedAt: null, createdAt: new Date(Date.now() - 3600000).toISOString() },
        ],
        total: 2,
        page: 1,
        limit: 25,
      });
    }),

    http.get(`${API_BASE}/api/v1/admin/diagnostics/runs/:id`, async ({ params }) => {
      return HttpResponse.json({
        id: params.id,
        config: { model: "glm", biovars: "1,4,6,12,15,18" },
        metrics: { auc: 0.92, tss: 0.78 },
        error: null,
      });
    }),

    http.get(`${API_BASE}/api/v1/admin/maintenance/logs`, async () => {
      return HttpResponse.json({
        entries: [{ id: "m1", type: "cache_clear", status: "completed", createdAt: new Date().toISOString() }],
        total: 1,
        page: 1,
        limit: 25,
      });
    }),

    http.get(`${API_BASE}/api/v1/auth/me`, async () => {
      return HttpResponse.json({
        id: "u1",
        email: "[EMAIL]",
        name: "Admin",
        role: "admin",
        avatarUrl: null,
        bio: null,
        organization: null,
        lastLoginAt: new Date().toISOString(),
        createdAt: "2024-01-01T00:00:00Z",
      });
    }),

    http.post(`${API_BASE}/api/v1/auth/login`, async () => {
      return HttpResponse.json({
        user: { id: "u1", email: "[EMAIL]", name: "Admin", role: "admin" },
        token: "mock-jwt-token",
      });
    }),

    http.get(`${API_BASE}/api/v1/auth/register`, async () => {
      return HttpResponse.json({
        user: { id: "u1", email: "[EMAIL]", name: "Admin", role: "admin" },
        token: "mock-jwt-token",
      });
    }),
  ];
}