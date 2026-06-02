import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { csrfMiddleware } from "./csrf";

describe("csrfMiddleware", () => {
  it("accepts same-origin requests forwarded through the frontend proxy", async () => {
    const app = new Hono();
    app.use("/projects", csrfMiddleware);
    app.post("/projects", (c) => c.json({ ok: true }));

    const res = await app.request("/projects", {
      method: "POST",
      headers: {
        Origin: "http://192.168.0.121:3000",
        Host: "api:4000",
        "X-Forwarded-Host": "192.168.0.121:3000",
      },
    });

    expect(res.status).toBe(200);
  });
});
