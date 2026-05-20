import { Hono } from "hono";
import { plumberClient } from "../services/plumber";

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
    const result = await plumberClient.cleanOccurrences(body);
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
  return c.json([]);
});
