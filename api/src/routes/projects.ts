import { Hono } from "hono";
import { db } from "../db/index.js";
import { projects, projectMembers } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.use("*", authMiddleware);

projectRoutes.get("/", async (c) => {
  try {
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
  } catch {
    return c.json({ error: "Internal error" }, 500);
  }
});

projectRoutes.post("/", async (c) => {
  try {
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
  } catch {
    return c.json({ error: "Internal error" }, 500);
  }
});

projectRoutes.put("/:id", async (c) => {
  try {
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
  } catch {
    return c.json({ error: "Internal error" }, 500);
  }
});

projectRoutes.delete("/:id", async (c) => {
  try {
    const user = c.get("user");
    const id = c.req.param("id");

    const [member] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, user.id)))
      .limit(1);

    if (!member || member.role !== "admin") {
      return c.json({ error: "Only project admins can delete projects" }, 403);
    }

    // Delete project members first, then the project
    await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
    const [deleted] = await db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning();

    if (!deleted) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json({ id, deleted: true });
  } catch {
    return c.json({ error: "Internal error" }, 500);
  }
});
