import { Hono } from "hono";

export const resultsRoutes = new Hono();

resultsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  return c.json({ id, message: "Results endpoint — implement Postgres query" }, 501);
});

resultsRoutes.get("/:id/raster/:layer.tif", async (c) => {
  return c.json({ message: "Raster download — stream from MinIO" }, 501);
});

resultsRoutes.get("/:id/report.txt", async (c) => {
  return c.json({ message: "Report download" }, 501);
});
