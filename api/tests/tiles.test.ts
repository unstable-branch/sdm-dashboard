import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Minimal test app replicating the tile route logic
function createTileApp(resultRoot: string) {
  const app = new Hono();

  app.get("/tiles/:runId/:z/:x/:y", async (c) => {
    const { runId, z, x, y } = c.req.param();

    if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
      return c.json({ error: "Invalid tile coordinates" }, 400);
    }

    const tilePath = join(resultRoot, runId, "map_tiles", "suitability", z, x, `${y}.png`);
    const { relative } = await import("path");
    const rel = relative(resultRoot, tilePath);
    if (!rel || rel.startsWith("..") || rel.startsWith("/")) {
      return c.json({ error: "Invalid tile path" }, 400);
    }

    if (!existsSync(tilePath)) {
      return c.body(null, 204);
    }

    const { readFileSync } = await import("fs");
    const buffer = readFileSync(tilePath);
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(buffer);
  });

  return app;
}

describe("Tile serving endpoint", () => {
  const testDir = join(tmpdir(), "tiles-test-" + Date.now());
  const runDir = join(testDir, "test-run-id", "map_tiles", "suitability", "4", "0");
  const tilePath = join(runDir, "0.png");
  let app: Hono;

  beforeEach(() => {
    mkdirSync(runDir, { recursive: true });
    // Write a minimal valid 1x1 red pixel PNG
    const minimalPng = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0xD7, 0x63, 0x68, 0x60, 0x60, 0x00,
      0x00, 0x00, 0x04, 0x00, 0x01, 0x27, 0x34, 0x27,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
      0xAE, 0x42, 0x60, 0x82,
    ]);
    writeFileSync(tilePath, minimalPng);
    app = createTileApp(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns 200 with PNG for existing tile", async () => {
    const res = await app.request("/tiles/test-run-id/4/0/0");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it("returns 204 for missing tile", async () => {
    const res = await app.request("/tiles/test-run-id/4/9/9");
    expect(res.status).toBe(204);
  });

  it("returns 400 for non-numeric z", async () => {
    const res = await app.request("/tiles/test-run-id/abc/0/0");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid tile");
  });

  it("returns 400 for non-numeric x", async () => {
    const res = await app.request("/tiles/test-run-id/4/abc/0");
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric y", async () => {
    const res = await app.request("/tiles/test-run-id/4/0/abc");
    expect(res.status).toBe(400);
  });

  it("rejects path traversal in runId", async () => {
    const res = await app.request("/tiles/../etc/passwd/4/0/0");
    expect(res.status).toBe(400);
  });
});
