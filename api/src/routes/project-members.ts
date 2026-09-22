import { Hono } from "hono";
import { db } from "../db/index.js";
import { projectMembers, projects, users } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";

/**
 * Bounded project-membership lifecycle (Phase 2 stage-2 acceptance surface).
 *
 * Contract (one canonical owner: this route file + project_members schema):
 * - The project owner (or a global admin) may add a member by email with an
 *   explicit project role of viewer, editor, or admin.
 * - The owner/global admin may change a member's role or remove them.
 * - A member may leave a project themselves.
 * - Every state change is effective immediately: downstream authorization
 *   (input assets, run access, SSE) reads project_members per request, so a
 *   removed member loses access on their next request without any cache
 *   invalidation path.
 * - All operations re-resolve the CURRENT database principal via
 *   authMiddleware; ownership/membership is rechecked immediately before each
 *   mutation; failures are typed and never fall open.
 */

export const projectMemberRoutes = new Hono<AppEnv>();

projectMemberRoutes.use("*", authMiddleware);

const PROJECT_ROLES = ["admin", "editor", "viewer"] as const;
type ProjectRole = (typeof PROJECT_ROLES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asProjectRole(value: unknown): ProjectRole | null {
  return typeof value === "string" && (PROJECT_ROLES as readonly string[]).includes(value)
    ? (value as ProjectRole)
    : null;
}

async function loadProject(projectId: string) {
  if (!UUID_RE.test(projectId)) return null;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return project ?? null;
}

/** Owner-of-record or global admin: the only actors that may manage members. */
async function canManageMembers(userId: string, globalRole: string, projectId: string): Promise<boolean> {
  if (globalRole === "admin") return true;
  const project = await loadProject(projectId);
  return project !== null && project.ownerId === userId;
}

projectMemberRoutes.post("/:id/members", async (c) => {
  try {
    const actor = c.get("user");
    const projectId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const role = asProjectRole(body.role);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!role) return c.json({ error: "Valid project role required (admin, editor, viewer)" }, 400);
    if (!email) return c.json({ error: "Member email required" }, 400);

    if (!(await canManageMembers(actor.id, actor.role, projectId))) {
      return c.json({ error: "Only the project owner or an admin can manage members" }, 403);
    }

    const [memberUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!memberUser) return c.json({ error: "User not found" }, 404);

    const project = await loadProject(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);
    if (project.ownerId === memberUser.id) {
      return c.json({ error: "Project owner is already a member" }, 409);
    }

    const [existing] = await db.select().from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberUser.id)))
      .limit(1);
    if (existing) return c.json({ error: "User is already a member" }, 409);

    const [member] = await db.insert(projectMembers)
      .values({ projectId, userId: memberUser.id, role })
      .returning();

    const client = extractClientInfo(c);
    await logAction({
      userId: actor.id,
      action: "project_member_added",
      entity: "project_members",
      entityId: member.id,
      ...client,
      details: { projectId, memberUserId: memberUser.id, role },
    });

    return c.json({ id: member.id, projectId, userId: memberUser.id, role }, 201);
  } catch {
    return c.json({ error: "Internal error" }, 500);
  }
});

projectMemberRoutes.patch("/:id/members/:memberId", async (c) => {
  try {
    const actor = c.get("user");
    const projectId = c.req.param("id");
    const memberId = c.req.param("memberId");
    const body = await c.req.json().catch(() => null);
    const role = body ? asProjectRole(body.role) : null;
    if (!role) return c.json({ error: "Valid project role required (admin, editor, viewer)" }, 400);

    if (!(await canManageMembers(actor.id, actor.role, projectId))) {
      return c.json({ error: "Only the project owner or an admin can manage members" }, 403);
    }

    const [member] = await db.select().from(projectMembers)
      .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
      .limit(1);
    if (!member) return c.json({ error: "Member not found" }, 404);

    const [updated] = await db.update(projectMembers)
      .set({ role })
      .where(eq(projectMembers.id, memberId))
      .returning();

    const client = extractClientInfo(c);
    await logAction({
      userId: actor.id,
      action: "project_member_role_changed",
      entity: "project_members",
      entityId: memberId,
      ...client,
      details: { projectId, from: member.role, to: role },
    });

    return c.json({ id: updated.id, projectId: updated.projectId, userId: updated.userId, role: updated.role });
  } catch {
    return c.json({ error: "Internal error" }, 500);
  }
});

projectMemberRoutes.delete("/:id/members/:memberId", async (c) => {
  try {
    const actor = c.get("user");
    const projectId = c.req.param("id");
    const memberId = c.req.param("memberId");

    const [member] = await db.select().from(projectMembers)
      .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
      .limit(1);
    if (!member) return c.json({ error: "Member not found" }, 404);

    // A member may always remove themselves; otherwise manager rights are required.
    if (member.userId !== actor.id && !(await canManageMembers(actor.id, actor.role, projectId))) {
      return c.json({ error: "Only the project owner or an admin can remove members" }, 403);
    }

    await db.delete(projectMembers).where(eq(projectMembers.id, memberId));

    const client = extractClientInfo(c);
    await logAction({
      userId: actor.id,
      action: "project_member_removed",
      entity: "project_members",
      entityId: memberId,
      ...client,
      details: { projectId, removedUserId: member.userId, previousRole: member.role },
    });

    return c.json({ id: memberId, removed: true });
  } catch {
    return c.json({ error: "Internal error" }, 500);
  }
});

projectMemberRoutes.get("/:id/members", async (c) => {
  try {
    const actor = c.get("user");
    const projectId = c.req.param("id");

    if (!(await canManageMembers(actor.id, actor.role, projectId))) {
      const [membership] = await db.select({ id: projectMembers.id }).from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.id)))
        .limit(1);
      if (!membership) return c.json({ error: "Access denied" }, 403);
    }

    const members = await db
      .select({
        id: projectMembers.id,
        userId: projectMembers.userId,
        role: projectMembers.role,
        email: users.email,
        name: users.name,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId));

    return c.json({ members });
  } catch {
    return c.json({ error: "Internal error" }, 500);
  }
});
