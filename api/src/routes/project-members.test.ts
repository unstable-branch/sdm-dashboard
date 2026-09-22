import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

/**
 * Boundary tests for the bounded project-membership lifecycle
 * (api/src/routes/project-members.ts): role gates and the self-removal
 * (leave) path through public operations. The DB is mocked below; the route's
 * decision logic is the contract under test.
 */

const OWNER = "00000000-0000-0000-0000-000000000001";
const EDITOR = "00000000-0000-0000-0000-000000000002";
const PROJECT = "00000000-0000-0000-0000-0000000000a1";
const MEMBER_ID = "00000000-0000-0000-0000-000000000011";

let currentUser: { id: string; email: string; role: string } = { id: OWNER, email: "[EMAIL]", role: "viewer" };
let project: { id: string; ownerId: string } | null = { id: PROJECT, ownerId: OWNER };
let memberRow: { id: string; projectId: string; userId: string; role: string } | null = null;
let deleted = false;

vi.mock("../db/schema.js", () => ({
  projectMembers: { id: "id", projectId: "project_id", userId: "user_id", role: "role" },
  projects: { id: "id", ownerId: "owner_id" },
  users: { id: "id", email: "email", name: "name" },
}));

vi.mock("../db", () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
        innerJoin: () => chain,
        returning: () => Promise.resolve([memberRow]),
        then: (resolve: (v: unknown) => unknown) => {
          // Which table was selected is decided by the where-shape the route
          // used; expose the single-row fixture the test last set.
          resolve(nextRows());
        },
      };
      return chain;
    },
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        const row = { ...vals, id: MEMBER_ID };
        const c2: Record<string, unknown> = {
          returning: () => Promise.resolve([row]),
          then: (resolve: (v: unknown) => unknown) => resolve([row]),
        };
        return c2;
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    }),
    delete: () => ({
      where: () => {
        deleted = true;
        return Promise.resolve([]);
      },
    }),
  },
}));

// The route performs up to three selects per request: project lookup,
// membership lookup, joined member listing. The test sets `nextRowsFn` to
// control what the await resolves to. Default: project row.
let nextRowsFn: () => unknown[] = () => (project ? [project] : []);
function setSelectRows(fn: () => unknown[]) {
  nextRowsFn = fn;
}
function nextRows(): unknown[] {
  const rows = nextRowsFn();
  // Each await consumes one configured row-set; fall back to empty.
  nextRowsFn = () => (project ? [project] : []);
  return rows;
}

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("user", currentUser);
    await next();
  },
}));

vi.mock("../services/audit.js", () => ({
  logAction: vi.fn(() => Promise.resolve()),
  extractClientInfo: vi.fn(() => ({ ipAddress: "[IP_ADDRESS]", userAgent: "test-agent" })),
}));

import { projectMemberRoutes } from "./project-members.js";

function app() {
  const a = new Hono();
  a.route("/api/v1/projects", projectMemberRoutes);
  return a;
}

describe("project membership lifecycle", () => {
  beforeEach(() => {
    project = { id: PROJECT, ownerId: OWNER };
    memberRow = null;
    deleted = false;
    currentUser = { id: OWNER, email: "[EMAIL]", role: "viewer" };
    setSelectRows(() => (project ? [project] : []));
  });

  it("rejects invalid project roles with 400", async () => {
    const res = await app().request(`/api/v1/projects/${PROJECT}/members`, {
      method: "POST",
      body: JSON.stringify({ email: "member@example.com", role: "superuser" }),
    });
    expect(res.status).toBe(400);
  });

  it("requires a member email with 400 when absent", async () => {
    const res = await app().request(`/api/v1/projects/${PROJECT}/members`, {
      method: "POST",
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(400);
  });

  it("denies member management by a global non-admin non-owner", async () => {
    currentUser = { id: EDITOR, email: "[EMAIL]", role: "viewer" };
    // Project lookup resolves, but ownerId !== EDITOR and role !== admin -> 403.
    const res = await app().request(`/api/v1/projects/${PROJECT}/members`, {
      method: "POST",
      body: JSON.stringify({ email: "member@example.com", role: "viewer" }),
    });
    expect(res.status).toBe(403);
  });

  it("denies malformed project ids closed before any data access", async () => {
    const res = await app().request("/api/v1/projects/not-a-uuid/members", {
      method: "POST",
      body: JSON.stringify({ email: "member@example.com", role: "viewer" }),
    });
    expect(res.status).toBe(403);
  });

  it("allows a member to remove themselves (leave path)", async () => {
    currentUser = { id: EDITOR, email: "[EMAIL]", role: "viewer" };
    memberRow = { id: MEMBER_ID, projectId: PROJECT, userId: EDITOR, role: "editor" };
    // Select sequence on DELETE /:id/members/:memberId for a self-removal:
    // 1) member lookup by id+project  2) manager gate is skipped for self.
    setSelectRows(() => [memberRow]);
    const res = await app().request(`/api/v1/projects/${PROJECT}/members/${MEMBER_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(true);
    expect(deleted).toBe(true);
  });

  it("denies removal of another member by a plain member", async () => {
    currentUser = { id: EDITOR, email: "[EMAIL]", role: "viewer" };
    memberRow = { id: MEMBER_ID, projectId: PROJECT, userId: OWNER, role: "admin" };
    setSelectRows(() => [memberRow]);
    const res = await app().request(`/api/v1/projects/${PROJECT}/members/${MEMBER_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    expect(deleted).toBe(false);
  });
});
