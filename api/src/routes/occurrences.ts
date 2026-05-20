import { Hono } from "hono";

export const dataRoutes = new Hono();

dataRoutes.post("/upload", async (c) => {
  return c.json({ message: "Upload endpoint — implement multipart handling" }, 501);
});

dataRoutes.post("/clean", async (c) => {
  return c.json({ message: "Clean endpoint — proxy to Plumber" }, 501);
});

dataRoutes.get("/species", async (c) => {
  return c.json([]);
});
