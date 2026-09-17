import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { projectMembers, projects, runs } from "../db/schema.js";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export async function getUserProjectIds(user: AuthUser): Promise<string[] | null> {
  if (user.role === "admin") {
    return null;
  }

  // Protected authorization must observe committed membership changes immediately.
  // Redis may still be used by discovery paths, but it is not authoritative for
  // resource decisions.
  const memberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id));

  return memberships.map((membership) => membership.projectId);
}

export async function ensureDefaultProject(user: AuthUser): Promise<string> {
  // Check existing membership first
  const [membership] = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id))
    .limit(1);

  if (membership) {
    return membership.projectId;
  }

  // Check if a "Default Project" already exists for this user (prevents duplicates
  // on concurrent calls where the race-condition check below might otherwise fire)
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.name, "Default Project"), eq(projects.ownerId, user.id)))
    .limit(1);

  if (existing) {
    // Project exists but user is not a member (edge case) — add membership
    await db
      .insert(projectMembers)
      .values({ projectId: existing.id, userId: user.id, role: "admin" });
    return existing.id;
  }

  // Create new project and membership
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

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function canAccessRun(userId: string, role: string, runId: string): Promise<boolean> {
  const idMatch = isUuid(runId) ? eq(runs.id, runId) : eq(runs.jobId, runId);

  if (role === "admin") {
    const [run] = await db.select({ id: runs.id }).from(runs).where(idMatch).limit(1);
    return Boolean(run);
  }

  const projectIds = await getUserProjectIds({ id: userId, email: "", role });
  if (!projectIds || projectIds.length === 0) {
    return false;
  }

  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(idMatch, inArray(runs.projectId, projectIds)))
    .limit(1);

  return Boolean(run);
}
