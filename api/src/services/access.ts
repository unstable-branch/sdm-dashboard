import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { projectMembers, projects, runs } from "../db/schema.js";
import { getSharedRedis } from "./queue.js";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

const PROJECT_CACHE_TTL = 60; // seconds

export async function getUserProjectIds(user: AuthUser): Promise<string[] | null> {
  if (user.role === "admin") {
    return null;
  }

  // Try Redis cache first
  const redis = getSharedRedis();
  if (redis) {
    const cacheKey = `user:projects:${user.id}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as string[];
      }
    } catch { /* cache miss — query DB */ }

    const memberships = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, user.id));

    const projectIds = memberships.map((membership) => membership.projectId);

    // Cache result (even empty array) with TTL
    try {
      await redis.setex(cacheKey, PROJECT_CACHE_TTL, JSON.stringify(projectIds));
    } catch { /* non-critical */ }

    return projectIds;
  }

  // Fallback: direct DB query when Redis unavailable
  const memberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id));

  return memberships.map((membership) => membership.projectId);
}

export async function ensureDefaultProject(user: AuthUser): Promise<string> {
  const [membership] = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id))
    .limit(1);

  if (membership) {
    return membership.projectId;
  }

  const [project] = await db
    .insert(projects)
    .values({
      name: "Default Project",
      description: "Default project for SDM runs and occurrence data.",
      ownerId: user.id,
    })
    .returning();

  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: "admin" });

  return project.id;
}

export async function canAccessRun(userId: string, role: string, runId: string): Promise<boolean> {
  if (role === "admin") {
    const [run] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).limit(1);
    return Boolean(run);
  }

  const projectIds = await getUserProjectIds({ id: userId, email: "", role });
  if (!projectIds || projectIds.length === 0) {
    return false;
  }

  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, runId), inArray(runs.projectId, projectIds)))
    .limit(1);

  return Boolean(run);
}
