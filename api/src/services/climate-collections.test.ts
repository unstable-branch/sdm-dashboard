import { describe, expect, it, vi } from "vitest";
import { stageValidatedClimateCollectionFromTrustedFiles, type TrustedClimateCollectionInput } from "./climate-collections.js";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const GRID = "a".repeat(64);

function trustedInput(overrides: Partial<TrustedClimateCollectionInput> = {}): TrustedClimateCollectionInput {
  return {
    kind: "current_baseline",
    provider: "Synthetic",
    dataset: "BIO",
    datasetVersion: "1",
    licence: "CC0",
    attribution: "Synthetic fixture",
    sourceEvidence: { url: "https://example.invalid/climate" },
    gridFingerprint: GRID,
    gridDefinition: { crs: "EPSG:4326", width: 2, height: 2 },
    baselineStart: "1981",
    baselineEnd: "2010",
    validatorIdentity: "test-validator/1",
    validationReport: { valid: true },
    members: [{
      systemRelativePath: "collection/bio01.tif",
      variableKey: "bio01",
      mediaKind: "image/tiff",
      units: "degC",
      datatype: "float32",
      nodataSemantics: { kind: "nan" },
      gridFingerprint: GRID,
      validationEvidence: { validator: "test-validator/1" },
    }],
    ...overrides,
  };
}

function authorityDatabase(role: "admin" | "editor") {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [{ role }]) })),
      })),
    })),
    transaction: vi.fn(),
  };
}

describe("trusted climate collection staging boundary", () => {
  it("rejects non-admin authority before reading any member bytes", async () => {
    const database = authorityDatabase("editor");
    const fs = { readFile: vi.fn(), realpath: vi.fn(), lstat: vi.fn() };
    await expect(stageValidatedClimateCollectionFromTrustedFiles(trustedInput(), ACTOR, {
      database: database as never,
      roots: { system: "/srv/climate" },
      fs: fs as never,
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(fs.realpath).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rechecks and locks current authority before reading member bytes", async () => {
    const lockedSelect = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => ({ limit: vi.fn(async () => [{ role: "editor" }]) })),
        })),
      })),
    }));
    const database = authorityDatabase("admin");
    database.transaction.mockImplementation(async (callback) => callback({ select: lockedSelect }));
    const fs = { open: vi.fn(), realpath: vi.fn(), lstat: vi.fn() };

    await expect(stageValidatedClimateCollectionFromTrustedFiles(trustedInput(), ACTOR, {
      database: database as never,
      roots: { system: "/srv/climate" },
      fs: fs as never,
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(fs.realpath).not.toHaveBeenCalled();
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("rejects an unavailable baseline before reading future member bytes", async () => {
    const lockedRows = (rows: unknown[]) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
        })),
      })),
    });
    const txSelect = vi.fn()
      .mockReturnValueOnce(lockedRows([{ role: "admin" }]))
      .mockReturnValueOnce(lockedRows([]));
    const database = authorityDatabase("admin");
    database.transaction.mockImplementation(async (callback) => callback({ select: txSelect }));
    const fs = { open: vi.fn(), realpath: vi.fn(), lstat: vi.fn() };

    await expect(stageValidatedClimateCollectionFromTrustedFiles(trustedInput({
      kind: "future_scenario",
      baselineStart: undefined,
      baselineEnd: undefined,
      futurePeriod: "2041-2060",
      ssp: "SSP2-4.5",
      gcm: "Synthetic-GCM",
      scenarioLabel: "Synthetic future",
      baselineCollectionId: "30000000-0000-4000-8000-000000000001",
    }), ACTOR, {
      database: database as never,
      roots: { system: "/srv/climate" },
      fs: fs as never,
    })).rejects.toMatchObject({ code: "conflict" });
    expect(fs.realpath).not.toHaveBeenCalled();
    expect(fs.open).not.toHaveBeenCalled();
  });

  it.each([
    { sourceEvidence: { storageLocator: "system/climate/bio01.tif" } },
    { gridDefinition: { sourcePath: "/srv/climate/bio01.tif" } },
    { members: [{ ...trustedInput().members[0], validationEvidence: { apiToken: "secret" } }] },
    { sourceEvidence: { uri: "file:///srv/climate/bio01.tif" } },
    { sourceEvidence: { url: "https://user:password@example.invalid/climate" } },
    { sourceEvidence: { url: "https://example.invalid/climate?X-Amz-Signature=secret" } },
    { validatorIdentity: "/srv/bin/climate-validator" },
    { validationReport: { valid: true, unsupported: undefined } },
    { gridDefinition: { width: Number.POSITIVE_INFINITY } },
    { attribution: "/srv/climate/private-source.txt" },
    { members: [{ ...trustedInput().members[0], mediaKind: "application/octet-stream" }] },
  ])("rejects forbidden or non-JSON metadata before authority or file access", async (override) => {
    const database = authorityDatabase("admin");
    const fs = { readFile: vi.fn(), realpath: vi.fn(), lstat: vi.fn() };
    await expect(stageValidatedClimateCollectionFromTrustedFiles(trustedInput(override as Partial<TrustedClimateCollectionInput>), ACTOR, {
      database: database as never,
      roots: { system: "/srv/climate" },
      fs: fs as never,
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(database.select).not.toHaveBeenCalled();
    expect(fs.realpath).not.toHaveBeenCalled();
  });

  it("rejects duplicate canonical member locators before authority or file access", async () => {
    const database = authorityDatabase("admin");
    const first = trustedInput().members[0];
    await expect(stageValidatedClimateCollectionFromTrustedFiles(trustedInput({
      members: [first, { ...first, variableKey: "bio02" }],
    }), ACTOR, {
      database: database as never,
      roots: { system: "/srv/climate" },
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(database.select).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "current_baseline", gcm: "must-not-exist" },
    { kind: "current_baseline", scenarioLabel: "must-not-exist" },
    { kind: "future_scenario", baselineStart: "1981", baselineEnd: "2010" },
    {
      kind: "future_scenario",
      baselineStart: undefined,
      baselineEnd: undefined,
      futurePeriod: "2041-2060",
      ssp: "SSP2-4.5",
      scenarioLabel: "future",
      baselineCollectionId: "30000000-0000-4000-8000-000000000001",
      gcm: undefined,
    },
    {
      kind: "derived_future",
      baselineStart: undefined,
      baselineEnd: undefined,
      futurePeriod: "2041-2060",
      ssp: "SSP2-4.5",
      scenarioLabel: "derived",
      baselineCollectionId: "30000000-0000-4000-8000-000000000001",
      gcm: "must-not-exist",
      parentCollectionIds: ["30000000-0000-4000-8000-000000000002"],
      derivationAlgorithmId: "average",
      derivationAlgorithmVersion: "1",
      derivationParameters: {},
      missingCellPolicy: "require_all",
      derivationSoftwareIdentity: {},
    },
  ] as Array<Partial<TrustedClimateCollectionInput>>)("rejects metadata that contradicts the collection kind", async (override) => {
    const database = authorityDatabase("admin");
    await expect(stageValidatedClimateCollectionFromTrustedFiles(trustedInput(override), ACTOR, {
      database: database as never,
      roots: { system: "/srv/climate" },
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(database.select).not.toHaveBeenCalled();
  });
});
