import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import type { AppEnv } from "../middleware/auth.js";

export const covariatesRoutes = new Hono<AppEnv>();

covariatesRoutes.post("/download", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const result = await plumberClient.withUser(user.id).post("/api/v1/covariates/download", body);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Covariate download failed";
    return c.json({ status: "error", message }, 502);
  }
});
