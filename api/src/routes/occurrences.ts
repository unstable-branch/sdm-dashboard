import { Hono } from "hono";
import { plumberClient } from "../services/plumber";
import { enqueueSdmJob } from "../services/queue";
import { db } from "../db";
import { species, occurrences } from "../db/schema";
import { eq } from "drizzle-orm";

export const dataRoutes = new Hono();

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

    if (async) {
      const jobId = await enqueueSdmJob({
        type: "clean",
        payload: body,
      });
      return c.json({ jobId, status: "queued" });
    }

    const result = await plumberClient.cleanOccurrences(body);

    if (result && typeof result === "object" && "occurrence_preview" in result) {
      const preview = result.occurrence_preview as Array<Record<string, unknown>>;
      if (preview.length > 0 && "longitude" in preview[0] && "latitude" in preview[0]) {
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

        const recordsToInsert = preview.map((row) => ({
          speciesId: sp.id,
          longitude: Number(row.longitude),
          latitude: Number(row.latitude),
          source: (row.source as string) || null,
          flagged: false,
          raw: row,
        }));

        if (recordsToInsert.length > 0) {
          await db.insert(occurrences).values(recordsToInsert);
          await db
            .update(species)
            .set({ occurrenceCount: (sp.occurrenceCount || 0) + recordsToInsert.length })
            .where(eq(species.id, sp.id));
        }
      }
    }

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clean failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.post("/occurrences/gbif/search", async (c) => {
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
    const body = await c.req.json();
    const result = await plumberClient.parseDwca(body);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "DwCA parse failed";
    return c.json({ error: message }, 502);
  }
});

dataRoutes.get("/species", async (c) => {
  try {
    const allSpecies = await db.select().from(species).orderBy(species.createdAt);
    return c.json(allSpecies);
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
    const recs = await db
      .select()
      .from(occurrences)
      .where(eq(occurrences.speciesId, id))
      .limit(1000);
    return c.json(recs);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch occurrences";
    return c.json({ error: message }, 500);
  }
});
