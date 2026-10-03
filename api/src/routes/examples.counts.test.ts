import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testState = vi.hoisted(() => ({ user: { id: "owner", role: "viewer" }, rawPath: "", cleanPath: "" }));
const storageMock = vi.hoisted(() => ({ writeAtomicSync: vi.fn(), actualWriteAtomicSync: null as ((path: string, data: Buffer | string) => void) | null }));
vi.mock("../services/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../services/storage.js")>("../services/storage.js");
  storageMock.actualWriteAtomicSync = actual.writeAtomicSync;
  return { ...actual, writeAtomicSync: storageMock.writeAtomicSync };
});
vi.mock("../middleware/auth.js", () => ({
  optionalAuth: vi.fn(async (c: any, next: any) => { c.set("user", testState.user); await next(); }),
  authMiddleware: vi.fn(async (c: any, next: any) => { c.set("user", testState.user); await next(); }),
}));
vi.mock("../services/input-assets.js", () => ({
  InputAssetRegistrationError: class InputAssetRegistrationError extends Error {},
  resolveInputAsset: vi.fn(async ({ assetId }: { assetId: string }) => ({
    ok: true,
    asset: { id: assetId, creatorUserId: "owner", scope: "private", kind: assetId === "clean" ? "cleaned_occurrence" : "raw_occurrence", state: "ready", projectId: null, parentAssetId: assetId === "clean" ? "raw" : null, contentSize: 20 },
    absolutePath: assetId === "clean" ? testState.cleanPath : testState.rawPath,
    adminAccess: false,
  })),
  registerInputAssetFromServerPath: vi.fn(),
}));
vi.mock("../services/upload-utils.js", () => ({ decryptToUploads: vi.fn() }));
vi.mock("../services/plumber.js", () => ({ plumberClient: {} }));

import { createExamplesRoutes } from "./examples.js";

const SCRATCH_ROOT = tmpdir();
let fixtureDir = "";
function app() { return new Hono().route("/examples", createExamplesRoutes(join(fixtureDir, "examples"))); }
async function save(metadata: Record<string, unknown>) {
  return app().request("/examples/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawAssetId: "raw", cleanedAssetId: "clean", metadata }) });
}
beforeEach(() => {
  storageMock.writeAtomicSync.mockReset();
  storageMock.writeAtomicSync.mockImplementation((path: string, data: Buffer | string) => storageMock.actualWriteAtomicSync!(path, data));
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  fixtureDir = mkdtempSync(join(SCRATCH_ROOT, "saved-example-count-"));
  testState.rawPath = join(fixtureDir, "raw.csv");
  testState.cleanPath = join(fixtureDir, "clean.csv");
  writeFileSync(testState.rawPath, "raw data");
  writeFileSync(testState.cleanPath, "clean data");
  testState.user = { id: "owner", role: "viewer" };
});
afterEach(() => rmSync(fixtureDir, { recursive: true, force: true }));

describe("saved cleaned example count contract", () => {
  it.each([
    ["omitted", {}, null], ["null", { valid_records: null }, null],
    ["zero", { valid_records: 0 }, 0], ["known", { valid_records: 7 }, 7],
  ])("persists and reads back %s cleaned counts", async (_label, countMeta, expected) => {
    const response = await save({ n_records: 10, original_rows: 10, ...countMeta });
    expect(response.status).toBe(200);
    const created = await response.json();
    expect(created.cleanRecords).toBe(expected);
    expect(created.dirtyRecords).toBe(expected == null ? null : 10 - expected);
    expect(created.hasCoordinateCleanerTests).toBe(expected == null ? null : expected < 10);
    const savedMeta = JSON.parse(readFileSync(join(fixtureDir, "examples", "saved_examples_meta.json"), "utf8"));
    expect(savedMeta[created.name].cleanRecords).toBe(expected);
    const details = await app().request("/examples/details");
    const readback = (await details.json()).examples.find((entry: { name: string }) => entry.name === created.name);
    expect(readback.cleanRecords).toBe(expected);
    expect(readback.dirtyRecords).toBe(expected == null ? null : 10 - expected);
    expect(readback.hasCoordinateCleanerTests).toBe(expected == null ? null : expected < 10);
    expect(readback.description).toContain(expected == null ? "unavailable" : "valid records");
  });
  it("rejects malformed counts without persisting metadata", async () => {
    const response = await save({ n_records: 10, original_rows: 10, valid_records: -1 });
    expect(response.status).toBe(400);
    expect(() => readFileSync(join(fixtureDir, "examples", "saved_examples_meta.json"), "utf8")).toThrow();
  });
  it.each([-1, 1.5, "2"]) ("rejects malformed n_species value %s before copying", async (nSpecies) => {
    const response = await save({ n_records: 10, original_rows: 10, n_species: nSpecies });
    expect(response.status).toBe(400);
    expect(() => readFileSync(join(fixtureDir, "examples", "saved_examples_meta.json"), "utf8")).toThrow();
  });
  it("removes only the new copied file and temp when metadata publication fails", async () => {
    const examplesDir = join(fixtureDir, "examples");
    mkdirSync(examplesDir, { recursive: true });
    const metaPath = join(examplesDir, "saved_examples_meta.json");
    const existingMeta = JSON.stringify({ previous: { fileName: "historical.csv", cleanRecords: 3 } });
    writeFileSync(metaPath, existingMeta);
    writeFileSync(join(examplesDir, "historical.csv"), "historical data");
    storageMock.writeAtomicSync.mockImplementationOnce(() => { throw new Error("injected metadata write failure"); });

    const response = await save({ n_records: 10, original_rows: 10, valid_records: 7 });
    expect(response.status).toBe(500);
    expect(readFileSync(metaPath, "utf8")).toBe(existingMeta);
    expect(readFileSync(join(examplesDir, "historical.csv"), "utf8")).toBe("historical data");
    expect(readdirSync(examplesDir).sort()).toEqual(["historical.csv", "saved_examples_meta.json"]);
  });
  it("preserves raw example numeric compatibility", async () => {
    const response = await app().request("/examples/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawAssetId: "raw", metadata: { n_records: 10, n_errors: 2 } }) });
    const result = await response.json();
    expect(result.cleanRecords).toBe(10);
    expect(result.dirtyRecords).toBe(2);
    expect(result.hasCoordinateCleanerTests).toBe(true);
  });
});
