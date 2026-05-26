import { Hono } from "hono";
import { readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "../db/index.js";
import { users, runs, auditLogs, systemSettings, maintenanceLog, occurrences, species, projects } from "../db/schema.js";
import { eq, desc, sql, and, gte, lte, like, inArray, count } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { hash } from "bcrypt";
import type { AppEnv } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const UPLOAD_DIR = join(PROJECT_ROOT, "data", "uploads");

export const adminRoutes = new Hono<AppEnv>();

const BCRYPT_ROUNDS = 12;

adminRoutes.use("*", authMiddleware);
adminRoutes.use("*", requireRole(["admin"]));
adminRoutes.use("*", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "admin" }));

adminRoutes.get("/overview", async (c) => {
  try {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [runCount] = await db.select({ count: count() }).from(runs);
    const [occurrenceCount] = await db.select({ count: count() }).from(occurrences);
    const [speciesCount] = await db.select({ count: count() }).from(species);
    const [projectCount] = await db.select({ count: count() }).from(projects);

    const [activeRuns] = await db.select({ count: count() }).from(runs).where(
      inArray(runs.status, ["queued", "running"])
    );

    const uploadsByUser = await db
      .select({
        userId: auditLogs.userId,
        count: count(),
      })
      .from(auditLogs)
      .where(eq(auditLogs.action, "occurrence_upload"))
      .groupBy(auditLogs.userId)
      .orderBy(desc(count()))
      .limit(10);

    // Enrich with user names (batched single query)
    const uploadStats: Array<{ userId: string | null; userName: string; count: number }> = [];
    const userIds = uploadsByUser.map((u) => u.userId).filter(Boolean) as string[];
    const userMap = new Map<string, string>();
    if (userIds.length > 0) {
      const matchedUsers = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of matchedUsers) {
        userMap.set(u.id, u.name || u.email);
      }
    }
    for (const u of uploadsByUser) {
      uploadStats.push({
        userId: u.userId,
        userName: u.userId ? (userMap.get(u.userId) || "Unknown") : "Unknown",
        count: u.count,
      });
    }

    const recentActivity = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(20);

    // Recent runs for run activity view
    const recentRuns = await db
      .select({
        id: runs.id,
        speciesName: runs.speciesName,
        modelId: runs.modelId,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        error: runs.error,
        cpuTimeMs: runs.cpuTimeMs,
        peakMemoryMb: runs.peakMemoryMb,
        rCpuTimeMs: runs.rCpuTimeMs,
        rPeakMemoryMb: runs.rPeakMemoryMb,
      })
      .from(runs)
      .orderBy(desc(runs.createdAt))
      .limit(15);

    return c.json({
      counts: {
        users: userCount?.count || 0,
        runs: runCount?.count || 0,
        occurrences: occurrenceCount?.count || 0,
        species: speciesCount?.count || 0,
        projects: projectCount?.count || 0,
        activeRuns: activeRuns?.count || 0,
      },
      uploadsByUser: uploadStats,
      recentActivity,
      recentRuns,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to load overview" }, 500);
  }
});

adminRoutes.get("/users", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = Math.min(parseInt(c.req.query("limit") || "25"), 100);
    const search = c.req.query("search") || "";
const offset = (page - 1) * limit;

    const [total] = await db.select({ count: count() }).from(users);

    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        organization: users.organization,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(search ? like(users.email, `%${search}%`) : undefined)
      .orderBy(desc(users.createdAt))
      .offset(offset)
      .limit(limit);

    return c.json({ users: allUsers, total: total?.count || 0, page, limit });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to list users" }, 500);
  }
});

adminRoutes.post("/users", async (c) => {
  try {
    const body = await c.req.json();
    const { email, password, name, role } = body;

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return c.json({ error: "Email already registered" }, 409);
    }

    const passwordHash = await hash(password, BCRYPT_ROUNDS);
    const [user] = await db.insert(users).values({
      email,
      passwordHash,
      name: name || null,
      role: role || "viewer",
    }).returning();

    const adminUser = c.get("user");
    const client = extractClientInfo(c as any);
    await logAction({
      userId: adminUser.id,
      action: "admin_user_create",
      entity: "users",
      entityId: user.id,
      ...client,
      details: { createdEmail: email, createdRole: role || "viewer" },
    });

    return c.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to create user" }, 500);
  }
});

adminRoutes.put("/users/:id", async (c) => {
  try {
    const targetId = c.req.param("id");
    const body = await c.req.json();
    const updates: Record<string, unknown> = {};

    if (body.email !== undefined) updates.email = body.email;
    if (body.name !== undefined) updates.name = body.name;
    if (body.role !== undefined) updates.role = body.role;
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.organization !== undefined) updates.organization = body.organization;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) {
      return c.json({ error: "User not found" }, 404);
    }

    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(users.id, targetId))
      .returning({
        id: users.id, email: users.email, name: users.name, role: users.role,
        avatarUrl: users.avatarUrl, bio: users.bio, organization: users.organization,
        lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
      });

    const adminUser = c.get("user");
    const client = extractClientInfo(c as any);
    await logAction({
      userId: adminUser.id,
      action: "admin_user_update",
      entity: "users",
      entityId: targetId,
      ...client,
      details: { changes: updates },
    });

    return c.json(updated);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to update user" }, 500);
  }
});

adminRoutes.delete("/users/:id", async (c) => {
  try {
    const targetId = c.req.param("id");
    const adminUser = c.get("user");

    if (targetId === adminUser.id) {
      return c.json({ error: "Cannot delete your own account" }, 400);
    }

    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) {
      return c.json({ error: "User not found" }, 404);
    }

    await db.delete(users).where(eq(users.id, targetId));

    const client = extractClientInfo(c as any);
    await logAction({
      userId: adminUser.id,
      action: "admin_user_delete",
      entity: "users",
      entityId: targetId,
      ...client,
      details: { deletedEmail: target.email },
    });

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to delete user" }, 500);
  }
});

adminRoutes.post("/users/:id/reset-password", async (c) => {
  try {
    const targetId = c.req.param("id");
    const body = await c.req.json();
    const newPassword = body.password;

    if (!newPassword || newPassword.length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }

    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) {
      return c.json({ error: "User not found" }, 404);
    }

    const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
    await db.update(users).set({ passwordHash, updatedAt: new Date() } as any).where(eq(users.id, targetId));

    const adminUser = c.get("user");
    const client = extractClientInfo(c as any);
    await logAction({
      userId: adminUser.id,
      action: "admin_password_reset",
      entity: "users",
      entityId: targetId,
      ...client,
    });

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to reset password" }, 500);
  }
});

adminRoutes.get("/logs", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
    const offset = (page - 1) * limit;
    const action = c.req.query("action") || undefined;
    const userId = c.req.query("userId") || undefined;
    const since = c.req.query("since") || undefined;
    const before = c.req.query("before") || undefined;

    const conditions = [];
    if (action) conditions.push(eq(auditLogs.action, action));
    if (userId) conditions.push(eq(auditLogs.userId, userId));
    if (since) conditions.push(gte(auditLogs.createdAt, new Date(since)));
    if (before) conditions.push(lte(auditLogs.createdAt, new Date(before)));

    const logs = await db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .offset(offset)
      .limit(limit);

    const [total] = await db.select({ count: count() }).from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return c.json({ logs, total: total?.count || 0, page, limit });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to query logs" }, 500);
  }
});

adminRoutes.get("/logs/actions", async (c) => {
  try {
    const actions = await db
      .select({ action: auditLogs.action, count: count() })
      .from(auditLogs)
      .groupBy(auditLogs.action)
      .orderBy(desc(count()));

    return c.json(actions);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to get action stats" }, 500);
  }
});

adminRoutes.get("/logs/timeline", async (c) => {
  try {
    const results = await db.execute(sql`
      SELECT
        DATE(created_at) as date,
        action,
        COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at), action
      ORDER BY DATE(created_at) DESC, action
    `);

    return c.json(results.rows);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to get timeline" }, 500);
  }
});

adminRoutes.get("/database/tables", async (c) => {
  try {
    const result = await db.execute(sql`
      SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size,
        n_live_tup as estimated_rows
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC
    `);

    return c.json(result.rows);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to list tables" }, 500);
  }
});

adminRoutes.get("/database/:table", async (c) => {
  try {
    const tableName = c.req.param("table");
    const page = Math.max(1, parseInt(c.req.query("page") || "1") || 1);
    const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "50") || 50), 200);
    const offset = (page - 1) * limit;

    const ALLOWED_TABLES = ["users", "projects", "project_members", "species", "runs", "occurrences", "api_keys", "user_settings", "audit_logs", "system_settings", "maintenance_log"];
    if (!ALLOWED_TABLES.includes(tableName)) {
      return c.json({ error: "Table not allowed" }, 403);
    }

    const columnsResult = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = ${tableName}
      ORDER BY ordinal_position
    `);

    const data = await db.execute(sql`
      SELECT * FROM ${sql.identifier(tableName)}
      ORDER BY created_at DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      SELECT COUNT(*) as total FROM ${sql.identifier(tableName)}
    `);
    const total = Number((countResult as any).rows?.[0]?.total || 0);

    return c.json({
      table: tableName,
      columns: columnsResult.rows,
      rows: (data as any).rows,
      total,
      page,
      limit,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to query table" }, 500);
  }
});

adminRoutes.get("/database/:table/stats", async (c) => {
  try {
    const tableName = c.req.param("table");
    const ALLOWED_TABLES = ["users", "projects", "project_members", "species", "runs", "occurrences", "api_keys", "user_settings", "audit_logs", "system_settings", "maintenance_log"];
    if (!ALLOWED_TABLES.includes(tableName)) {
      return c.json({ error: "Table not allowed" }, 403);
    }

    const indexes = await db.execute(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = ${tableName}
    `);

    const constraints = await db.execute(sql`
      SELECT conname, contype
      FROM pg_constraint
      JOIN pg_class ON pg_constraint.conrelid = pg_class.oid
      WHERE relname = ${tableName}
    `);

    const size = await db.execute(sql`
      SELECT pg_size_pretty(pg_total_relation_size(${sql.identifier(tableName)})) as total_size
    `);

    return c.json({
      table: tableName,
      indexes: indexes.rows,
      constraints: constraints.rows,
      size: (size.rows as any)?.[0]?.total_size || "unknown",
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to get table stats" }, 500);
  }
});

adminRoutes.get("/system/settings", async (c) => {
  try {
    const settings = await db.select().from(systemSettings).orderBy(systemSettings.key);
    return c.json(settings);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to get system settings" }, 500);
  }
});

adminRoutes.put("/system/settings", async (c) => {
  try {
    const body = await c.req.json();
    const adminUser = c.get("user");

    if (!body.key || body.value === undefined) {
      return c.json({ error: "key and value are required" }, 400);
    }

    const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.key, body.key)).limit(1);
    if (!existing) {
      return c.json({ error: "Setting key not found" }, 404);
    }

    const [updated] = await db
      .update(systemSettings)
      .set({ value: body.value, updatedBy: adminUser.id, updatedAt: new Date() })
      .where(eq(systemSettings.key, body.key))
      .returning();

    const client = extractClientInfo(c as any);
    await logAction({
      userId: adminUser.id,
      action: "system_settings_update",
      entity: "system_settings",
      entityId: updated.id,
      ...client,
      details: { key: body.key, value: body.value },
    });

    return c.json(updated);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to update setting" }, 500);
  }
});

adminRoutes.post("/system/cache/clear", async (c) => {
  try {
    const adminUser = c.get("user");
    const client = extractClientInfo(c as any);

    try {
      const { invalidateCache } = await import("../middleware/cache.js");
      await invalidateCache("long");
      await invalidateCache("medium");
    } catch {
      // Cache clear is best-effort
    }

    await db.insert(maintenanceLog).values({
      type: "cache_clear",
      status: "completed",
      details: { triggeredBy: adminUser.id },
    });

    await logAction({
      userId: adminUser.id,
      action: "system_cache_clear",
      entity: "maintenance",
      ...client,
    });

    return c.json({ ok: true, message: "Cache cleared" });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to clear cache" }, 500);
  }
});

adminRoutes.post("/system/jobs/cleanup", async (c) => {
  try {
    const adminUser = c.get("user");
    const client = extractClientInfo(c as any);

    const staleRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(inArray(runs.status, ["queued", "running"]))
      .limit(0);

    await db.insert(maintenanceLog).values({
      type: "job_cleanup",
      status: "completed",
      details: { staleJobsFound: staleRuns.length, triggeredBy: adminUser.id },
    });

    await logAction({
      userId: adminUser.id,
      action: "system_job_cleanup",
      entity: "maintenance",
      ...client,
      details: { staleJobsFound: staleRuns.length },
    });

    return c.json({ ok: true, message: `Found ${staleRuns.length} stale jobs`, staleJobs: staleRuns.length });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to clean up jobs" }, 500);
  }
});

adminRoutes.get("/diagnostics/uploads", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = Math.min(parseInt(c.req.query("limit") || "25"), 100);
    const offset = (page - 1) * limit;

    // Get upload audit logs with user info
    const uploadLogs = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.action, "occurrence_upload"))
      .orderBy(desc(auditLogs.createdAt))
      .offset(offset)
      .limit(limit);

    const [countResult] = await db
      .select({ count: count() })
      .from(auditLogs)
      .where(eq(auditLogs.action, "occurrence_upload"));
    const total = countResult?.count ?? 0;

    // Batch-fetch user names
    const userIds = uploadLogs.map((l) => l.userId).filter(Boolean) as string[];
    const userMap = new Map<string, string>();
    if (userIds.length > 0) {
      const matchedUsers = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of matchedUsers) {
        userMap.set(u.id, u.name || u.email);
      }
    }

    // Batch-fetch occurrence + run counts by pipelineRunId
    const pipelineRunIds = uploadLogs
      .map((l) => l.entityId || ((l.details as any)?.pipelineRunId as string | undefined) || null)
      .filter(Boolean) as string[];

    const [occStatsList, runsStatsList] = await Promise.all([
      pipelineRunIds.length > 0
        ? db
            .select({
              pipelineRunId: occurrences.pipelineRunId,
              total: count(),
              flagged: sql<number>`COALESCE(SUM(CASE WHEN flagged = true THEN 1 ELSE 0 END), 0)`,
            })
            .from(occurrences)
            .where(inArray(occurrences.pipelineRunId, pipelineRunIds))
            .groupBy(occurrences.pipelineRunId)
        : Promise.resolve([]),
      pipelineRunIds.length > 0
        ? db
            .select({
              pipelineRunId: runs.pipelineRunId,
              count: count(),
            })
            .from(runs)
            .where(inArray(runs.pipelineRunId, pipelineRunIds))
            .groupBy(runs.pipelineRunId)
        : Promise.resolve([]),
    ]);

    const occMap = new Map(occStatsList.map((o) => [o.pipelineRunId, o]));
    const runsMap = new Map(runsStatsList.map((r) => [r.pipelineRunId, r.count]));

    // Enrich with batched data (no per-row queries)
    const enriched = uploadLogs.map((log) => {
      const pipelineRunId = log.entityId || (log.details as any)?.pipelineRunId || null;
      const occStats = pipelineRunId ? occMap.get(pipelineRunId) : undefined;
      return {
        id: log.id,
        userId: log.userId,
        userName: log.userId ? userMap.get(log.userId) || "Unknown" : "Unknown",
        pipelineRunId,
        details: log.details,
        createdAt: log.createdAt,
        recordCount: occStats?.total || 0,
        flaggedCount: typeof occStats?.flagged === "number" ? occStats.flagged : 0,
        runCount: pipelineRunId ? runsMap.get(pipelineRunId) || 0 : 0,
      };
    });

    return c.json({ uploads: enriched, total, page, limit });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to list uploads" }, 500);
  }
});

adminRoutes.get("/diagnostics/filesystem", async (c) => {
  try {
    let files: { name: string; size: number; lastModified: string; isCleaned: boolean }[] = [];
    let totalSize = 0;
    let rawCount = 0;
    let cleanedCount = 0;

    try {
      const entries = readdirSync(UPLOAD_DIR);
      for (const name of entries) {
        const fullPath = join(UPLOAD_DIR, name);
        try {
          const stat = statSync(fullPath);
          if (stat.isFile()) {
            const isCleaned = name.startsWith("cleaned_");
            files.push({ name, size: stat.size, lastModified: stat.mtime.toISOString(), isCleaned });
            totalSize += stat.size;
            if (isCleaned) cleanedCount++; else rawCount++;
          }
        } catch { /* skip unreadable */ }
      }
    } catch {
      return c.json({ error: "Uploads directory not accessible" }, 500);
    }

    // Sort by lastModified descending
    files.sort((a, b) => b.lastModified.localeCompare(a.lastModified));

    return c.json({
      files: files.slice(0, 100),
      totalFiles: rawCount + cleanedCount,
      totalSize,
      rawCount,
      cleanedCount,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to list filesystem" }, 500);
  }
});

adminRoutes.get("/diagnostics/runs", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = Math.min(parseInt(c.req.query("limit") || "25"), 100);
    const status = c.req.query("status") || undefined;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (status) conditions.push(eq(runs.status, status as any));

    const allRuns = await db
      .select({
        id: runs.id,
        speciesName: runs.speciesName,
        modelId: runs.modelId,
        status: runs.status,
        jobId: runs.jobId,
        bullmqId: runs.bullmqId,
        runNumber: runs.runNumber,
        progressLog: runs.progressLog,
        error: runs.error,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        createdAt: runs.createdAt,
      })
      .from(runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(runs.createdAt))
      .offset(offset)
      .limit(limit);

    const [total] = await db.select({ count: count() }).from(runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return c.json({ runs: allRuns, total: total?.count || 0, page, limit });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to list runs" }, 500);
  }
});

adminRoutes.get("/diagnostics/runs/:id", async (c) => {
  try {
    const runId = c.req.param("id");
    const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json(run);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to get run" }, 500);
  }
});

adminRoutes.get("/maintenance/logs", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = Math.min(parseInt(c.req.query("limit") || "25"), 100);
    const offset = (page - 1) * limit;

    const entries = await db
      .select()
      .from(maintenanceLog)
      .orderBy(desc(maintenanceLog.createdAt))
      .offset(offset)
      .limit(limit);

    const [total] = await db.select({ count: count() }).from(maintenanceLog);

    return c.json({ entries, total: total?.count || 0, page, limit });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to get maintenance logs" }, 500);
  }
});