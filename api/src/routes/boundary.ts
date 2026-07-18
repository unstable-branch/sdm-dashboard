import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../middleware/auth.js";
import { logAction, extractClientInfo } from "../services/audit.js";
import { resolveFilePath } from "../services/upload-utils.js";

export const boundaryRoutes = new Hono<AppEnv>();

boundaryRoutes.use("*", authMiddleware);

boundaryRoutes.get("/boundary/default", async (c) => {
  try {
    const user = c.get("user");
    const resolution = c.req.query("resolution");
    const type = c.req.query("type");
    const country = c.req.query("country");
    const body: Record<string, unknown> = {};
    if (resolution) body.resolution = resolution;
    if (type) body.type = type;
    if (country) body.country = country;
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/default", body);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch boundary";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.post("/boundary/upload", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/upload", {
      file_name: file.name,
      file_content: base64,
    });

    const client = extractClientInfo(c as any);
    await logAction({
      userId: user.id,
      action: "boundary_uploaded",
      entity: "boundary",
      entityId: (res as Record<string, unknown>)?.file_path as string | null ?? null,
      ...client,
      details: { fileName: file.name, fileSize: file.size },
    });

    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Boundary upload failed";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.get("/boundary/list", async (c) => {
  try {
    const user = c.get("user");
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/list", {});
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list boundaries";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.delete("/boundary/delete/:id", async (c) => {
  try {
    const user = c.get("user");
    const filePath = c.req.param("id");
    if (!filePath || typeof filePath !== "string" || filePath.includes("..") || filePath.startsWith("/")) {
      return c.json({ error: "Invalid file path" }, 400);
    }
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/delete", { file_path: filePath });

    const client = extractClientInfo(c as any);
    await logAction({
      userId: user.id,
      action: "boundary_deleted",
      entity: "boundary",
      entityId: filePath,
      ...client,
    });

    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete boundary";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.get("/boundary/countries", async (c) => {
  try {
    const user = c.get("user");
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/countries", {});
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch countries";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.get("/boundary/extent", async (c) => {
  try {
    const user = c.get("user");
    const filePath = c.req.query("file_path");
    const type = c.req.query("type");
    const resolution = c.req.query("resolution");
    const country = c.req.query("country");
    const bufferDeg = c.req.query("buffer_deg") || "2";
    const body: Record<string, unknown> = { buffer_deg: Number(bufferDeg) };
    if (filePath) body.file_path = filePath;
    if (type) body.type = type;
    if (resolution) body.resolution = resolution;
    if (country) body.country = country;
    const res = await plumberClient.withUser(user.id).post("/api/v1/data/boundary/extent", body);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute extent";
    return c.json({ error: message }, 502);
  }
});

boundaryRoutes.post("/boundary/download", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const [status, data] = await plumberClient.withUser(user.id).postRaw("/api/v1/data/boundary/download", body);
    return c.json(data, status >= 400 ? (status as 400 | 404 | 500) : 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to download boundary";
    return c.json({ error: message }, 502);
  }
});
