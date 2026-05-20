import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const resultsRoutes = new Hono();

const appDir = process.cwd();

resultsRoutes.get("/file/:filePath", async (c) => {
  const filePath = decodeURIComponent(c.req.param("filePath"));
  const fullPath = join(appDir, filePath);

  if (!existsSync(fullPath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const ext = filePath.split(".").pop()?.toLowerCase();
  const contentType = ext === "tif" || ext === "tiff" ? "image/tiff" :
                      ext === "png" ? "image/png" :
                      ext === "txt" ? "text/plain" :
                      ext === "csv" ? "text/csv" :
                      "application/octet-stream";

  c.header("Content-Type", contentType);
  c.header("Content-Disposition", `attachment; filename="${filePath.split("/").pop()}"`);

  const buffer = readFileSync(fullPath);
  return c.body(buffer);
});

resultsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const metaPath = join(appDir, "outputs", "jobs", id, "meta.json");

  if (!existsSync(metaPath)) {
    return c.json({ error: "Run not found" }, 404);
  }

  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  return c.json(meta);
});

resultsRoutes.get("/:id/report.txt", async (c) => {
  const id = c.req.param("id");
  const reportPath = join(appDir, "outputs", "jobs", id, "report.txt");

  if (!existsSync(reportPath)) {
    return c.json({ error: "Report not found" }, 404);
  }

  c.header("Content-Type", "text/plain");
  return c.body(readFileSync(reportPath, "utf-8"));
});
