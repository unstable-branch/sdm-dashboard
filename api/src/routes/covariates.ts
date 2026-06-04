import { Hono } from "hono";
import { plumberClient } from "../services/plumber.js";
import type { AppEnv } from "../middleware/auth.js";

export const covariatesRoutes = new Hono<AppEnv>();

covariatesRoutes.post("/download", async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const [status, result] = await plumberClient.withUser(user.id).postRaw("/api/v1/covariates/download", body);
    return c.json(result, status >= 400 ? (status as 400 | 500) : 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Covariate download failed";
    return c.json({ status: "error", message }, 502);
  }
});
