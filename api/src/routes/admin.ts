import { Hono } from "hono";
import { readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "../db/index.js";
import { users, runs, systemSettings, occurrences, species, projects, uploadedFiles } from "../db/schema.js";
import { eq, desc, sql, and, like, inArray, count } from "drizzle-orm";
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

// Logs endpoints removed (audit_logs table dropped)

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

    const ALLOWED_TABLES = ["users", "projects", "project_members", "species", "runs", "occurrences", "api_keys", "user_settings", "system_settings"];
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
    const ALLOWED_TABLES = ["users", "projects", "project_members", "species", "runs", "occurrences", "api_keys", "user_settings", "system_settings"];
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

    return c.json({ ok: true, message: "Cache cleared" });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to clear cache" }, 500);
  }
});

adminRoutes.post("/system/jobs/cleanup", async (c) => {
  try {
    const staleRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(inArray(runs.status, ["queued", "running"]))
      .limit(0);

    return c.json({ ok: true, message: `Found ${staleRuns.length} stale jobs`, staleJobs: staleRuns.length });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to clean up jobs" }, 500);
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
        lastStage: runs.lastStage,
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

// Maintenance logs endpoint removed (maintenance_log table dropped)

adminRoutes.get("/diagnostics/uploads", async (c) => {
  try {
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "25", 10)));
    const offset = (page - 1) * limit;

    const records = await db
      .select({
        id: uploadedFiles.id,
        userId: uploadedFiles.userId,
        createdAt: uploadedFiles.createdAt,
        recordCount: uploadedFiles.nRows,
      })
      .from(uploadedFiles)
      .orderBy(desc(uploadedFiles.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(uploadedFiles);

    const uploads = records.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userId || "unknown",
      details: null,
      createdAt: r.createdAt?.toISOString() ?? "",
      recordCount: r.recordCount ?? 0,
      flaggedCount: 0,
      runCount: 0,
    }));

    return c.json({ uploads, total, page, limit });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to get uploads" }, 500);
  }
});