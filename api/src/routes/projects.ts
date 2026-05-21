import { Hono } from "hono";
import { db } from "../db";
import { projects, projectMembers, users } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth";
import type { AppEnv } from "../middleware/auth";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.use("*", authMiddleware);

projectRoutes.get("/", async (c) => {
  const user = c.get("user");

  const userProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      role: projectMembers.role,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(eq(projectMembers.userId, user.id));

  return c.json(userProjects);
});

projectRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { name, description } = body;

  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }

  const [project] = await db
    .insert(projects)
    .values({ name, description, ownerId: user.id })
    .returning();

  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: "admin" });

  return c.json(project);
});

projectRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json();
  const { name, description } = body;

  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }

  const [member] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, user.id)))
    .limit(1);

  if (!member || member.role !== "admin") {
    return c.json({ error: "Only project admins can update projects" }, 403);
  }

  const [updated] = await db
    .update(projects)
    .set({ name, description })
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json(updated);
});

projectRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const [project] = await db
    .select()
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.id, id), eq(projectMembers.userId, user.id)))
    .limit(1);

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json(project.projects);
});

projectRoutes.get("/:id/members", async (c) => {
  const id = c.req.param("id");

  const members = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, id));

  return c.json(members);
});

projectRoutes.post("/:id/members", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json();
  const { email, role } = body;

  if (!email) {
    return c.json({ error: "Email is required" }, 400);
  }

  const [member] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, user.id)))
    .limit(1);

  if (!member || (member.role !== "admin")) {
    return c.json({ error: "Only project admins can add members" }, 403);
  }

  const [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!targetUser) {
    return c.json({ error: "User not found" }, 404);
  }

  const [newMember] = await db
    .insert(projectMembers)
    .values({ projectId: id, userId: targetUser.id, role: role || "viewer" })
    .returning();

  return c.json(newMember);
});

projectRoutes.delete("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const [member] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, user.id)))
    .limit(1);

  if (!member || (member.role !== "admin")) {
    return c.json({ error: "Only project admins can remove members" }, 403);
  }

  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, targetUserId)));

  return c.json({ ok: true });
});
