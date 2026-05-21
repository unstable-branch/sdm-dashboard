import { Hono } from "hono";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { plumberClient } from "../services/plumber";
import { enqueueSdmJob } from "../services/queue";
import { db } from "../db";
import { species, occurrences } from "../db/schema";
import { eq, count } from "drizzle-orm";
import { gbifRateLimit, defaultRateLimit } from "../middleware/rate-limit";
import { authMiddleware, optionalAuth } from "../middleware/auth";
import type { AppEnv } from "../middleware/auth";

export const dataRoutes = new Hono<AppEnv>();

dataRoutes.use("*", defaultRateLimit);
dataRoutes.use("/occurrences/upload", authMiddleware);
dataRoutes.use("/occurrences/clean", authMiddleware);
dataRoutes.use("/occurrences/gbif/search", authMiddleware);
dataRoutes.use("/occurrences/dwca", authMiddleware);
dataRoutes.use("*", optionalAuth);

dataRoutes.post("/occurrences/upload", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await plumberClient.uploadOccurrence(buffer, file.name);

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/clean", async (c) => {
  try {
    const body = await c.req.json();
    const async = body.async === true;
    const user = c.get("user");

    if (async) {
      const jobId = await enqueueSdmJob(
        {
          type: "clean",
          payload: body,
        },
        user.id
      );
      return c.json({ jobId, status: "queued" });
    }

    const result = await plumberClient.cleanOccurrences(body);

    if (result && typeof result === "object" && "cleaned_id" in result) {
      const cleanedId = result.cleaned_id as string;
      const speciesName = (body.species as string) || "Untitled species";

      let [sp] = await db
        .select()
        .from(species)
        .where(eq(species.name, speciesName))
        .limit(1);

      if (!sp) {
        [sp] = await db
          .insert(species)
          .values({ name: speciesName, occurrenceCount: 0 })
          .returning();
      }

      const cleanedRecords = parseCsvRecords(cleanedId);
      const validRecords = cleanedRecords.filter(
        (r) => typeof r.longitude === "number" && typeof r.latitude === "number" && isFinite(r.longitude) && isFinite(r.latitude)
      );

      if (validRecords.length > 0) {
        const recordsToInsert = validRecords.map((row) => ({
          speciesId: sp.id,
          filePath: cleanedId,
          longitude: Number(row.longitude),
          latitude: Number(row.latitude),
          source: (row.source as string) || null,
          flagged: Boolean(row.flagged || row.cc_flag),
          flagReason: (row.flag_reason as string) || null,
          cleaned: true,
          raw: row,
        }));

        await db.insert(occurrences).values(recordsToInsert);
        await db
          .update(species)
          .set({ occurrenceCount: (sp.occurrenceCount || 0) + recordsToInsert.length })
          .where(eq(species.id, sp.id));
      }
    }

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clean failed";
    return c.json({ error: message }, 502);
  }
});

function parseCsvRecords(filePath: string): Array<Record<string, unknown>> {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const records: Array<Record<string, unknown>> = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length !== headers.length) continue;

      const record: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        const val = values[j].trim();
        const num = Number(val);
        record[headers[j]] = isNaN(num) ? val : num;
      }
      records.push(record);
    }

    return records;
  } catch {
    return [];
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

dataRoutes.post("/occurrences/gbif/search", gbifRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const result = await plumberClient.searchGbif(body);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "GBIF search failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/dwca", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const tmpDir = join(process.cwd(), "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `dwca-${Date.now()}-${file.name}`);
    writeFileSync(tmpPath, buffer);

    const result = await plumberClient.uploadOccurrence(tmpPath, file.name);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "DwCA parse failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.get("/species", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1", 10);
    const limitVal = parseInt(c.req.query("limit") || "50", 10);
    const offset = (page - 1) * limitVal;

    const allSpecies = await db
      .select()
      .from(species)
      .orderBy(species.createdAt)
      .limit(limitVal)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(species);

    return c.json({
      species: allSpecies,
      pagination: {
        page,
        limit: limitVal,
        total,
        totalPages: Math.ceil(total / limitVal),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch species";
    return c.json({ error: message }, 500);
  }
});

dataRoutes.get("/species/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const [sp] = await db.select().from(species).where(eq(species.id, id)).limit(1);
    if (!sp) return c.json({ error: "Species not found" }, 404);
    return c.json(sp);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch species";
    return c.json({ error: message }, 500);
  }
});

dataRoutes.get("/species/:id/occurrences", async (c) => {
  try {
    const id = c.req.param("id");
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "100", 10);
    const offset = (page - 1) * limit;

    const recs = await db
      .select()
      .from(occurrences)
      .where(eq(occurrences.speciesId, id))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(occurrences)
      .where(eq(occurrences.speciesId, id));

    return c.json({
      occurrences: recs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch occurrences";
    return c.json({ error: message }, 500);
  }
});