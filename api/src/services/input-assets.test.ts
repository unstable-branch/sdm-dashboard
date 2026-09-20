import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type InputAssetDependencies,
  type InputAssetPrincipal,
  type InputAssetRow,
  resolveInputAsset,
  resolveInputAssetStorage,
  resolveLegacyInputAsset,
  registerInputAsset,
  registerDerivedInputAsset,
  registerSystemInputAsset,
  registerInputAssetFromServerPath,
  registerClimateCollectionFromServerPath,
  registerSystemClimateCollectionFromServerPath,
  makeInputAssetLocator,
  InputAssetRegistrationError,
} from "./input-assets.js";
import { inputAssetLegacyMappings, inputAssets, projectMembers } from "../db/schema.js";

const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";
const G = "00000000-0000-0000-0000-000000000003";
const P = "00000000-0000-0000-0000-000000000010";
const RAW = "00000000-0000-0000-0000-000000000101";
const CHILD = "00000000-0000-0000-0000-000000000102";
const CLIMATE = "00000000-0000-0000-0000-000000000103";
const LEGACY = "00000000-0000-0000-0000-000000000201";

type RowOverrides = Partial<InputAssetRow>;

function asset(id: string, overrides: RowOverrides = {}): InputAssetRow {
  const now = new Date();
  return {
    id,
    creatorUserId: A,
    projectId: null,
    scope: "private",
    kind: "raw_occurrence",
    storageLocator: "uploads/asset.csv",
    parentAssetId: null,
    state: "ready",
    contentSha256: null,
    contentSize: 3,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    quarantinedAt: null,
    ...overrides,
  };
}

function fakeDatabase(options: {
  assets?: InputAssetRow[];
  membershipRole?: "admin" | "editor" | "viewer";
  mapping?: Record<string, unknown>;
  unavailable?: boolean;
} = {}): InputAssetDependencies["database"] {
  const assetRows = [...(options.assets || [])];
  const database = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (options.unavailable) throw new Error("db down");
            if (table === inputAssets) {
              const row = assetRows.shift();
              return row ? [row] : [];
            }
            if (table === projectMembers) return options.membershipRole ? [{ role: options.membershipRole, id: "membership" }] : [];
            if (table === inputAssetLegacyMappings) return options.mapping?.mappingState === "verified" ? [options.mapping] : [];
            return [];
          },
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  } as unknown as InputAssetDependencies["database"];
  return database;
}

function principal(id: string, role: InputAssetPrincipal["role"] = "viewer"): InputAssetPrincipal {
  return { id, role };
}

let root: string;
const roots = () => ({ uploads: root, boundaries: root, system: root });

beforeEach(async () => {
  root = await mkdtemp("/tmp/sdm-input-assets-");
  await writeFile(join(root, "asset.csv"), "abc");
  await writeFile(join(root, "raw.csv"), "raw");
  await writeFile(join(root, "clean.csv"), "clean");
  await writeFile(join(root, "climate.tif"), "climate");
  await writeFile(join(root, "climate.json"), JSON.stringify({
    version: 1, metadata: { source: "synthetic", resolution: 10 },
    members: [{ locator: "uploads/climate.tif", sha256: "10db699812d02cc570ad3bdef91138092088ff2718c1ef1d4ee308a89defe62a", size: 7, metadata: { variable: "bio1" } }],
  }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("canonical input asset storage containment", () => {
  it("requires exact root containment and rejects traversal, missing files, and symlinks", async () => {
    expect(await resolveInputAssetStorage("uploads/asset.csv", roots())).toMatchObject({ absolutePath: join(root, "asset.csv") });
    expect(await resolveInputAssetStorage("uploads/../asset.csv", roots())).toBeNull();
    expect(await resolveInputAssetStorage("uploads/asset.csv/../../x", roots())).toBeNull();
    expect(await resolveInputAssetStorage("uploads-other/asset.csv", roots())).toBeNull();
    expect(await resolveInputAssetStorage("uploads/missing.csv", roots())).toBeNull();
    await symlink(join(root, "asset.csv"), join(root, "link.csv"));
    expect(await resolveInputAssetStorage("uploads/link.csv", roots())).toBeNull();
  });

  it("does not accept absolute paths, URL aliases, separators, or client path aliases", async () => {
    for (const locator of ["/tmp/asset.csv", "file:///tmp/asset.csv", "uploads\\asset.csv", "uploads:asset.csv", "uploads//asset.csv"]) {
      expect(await resolveInputAssetStorage(locator, roots())).toBeNull();
    }
    expect(makeInputAssetLocator("uploads", "../asset.csv", roots())).toBeNull();
    expect(makeInputAssetLocator("uploads", "/etc/passwd", roots())).toBeNull();
  });
});

describe("canonical climate collection manifests", () => {
  it("reuses an immutable system collection across requesting principals", async () => {
    const climateRoot = join(root, "Worldclim");
    await mkdir(climateRoot);
    await writeFile(join(climateRoot, "climate.tif"), "climate");
    await writeFile(join(climateRoot, "climate.json"), JSON.stringify({
      version: 1, metadata: { source: "worldclim", resolution: 10 },
      members: [{ locator: "worldclim/climate.tif", sha256: "10db699812d02cc570ad3bdef91138092088ff2718c1ef1d4ee308a89defe62a", size: 7, metadata: { variable: "bio1" } }],
    }));
    const climateRoots = { ...roots(), worldclim: climateRoot };
    const manifestContent = await readFile(join(climateRoot, "climate.json"));
    const existing = asset(CLIMATE, {
      creatorUserId: A,
      scope: "system",
      kind: "climate_collection",
      storageLocator: "worldclim/climate.json",
      contentSha256: createHash("sha256").update(manifestContent).digest("hex"),
      contentSize: manifestContent.length,
    });
    const database = {
      insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [existing] }) }) }),
    } as unknown as InputAssetDependencies["database"];

    await expect(registerSystemClimateCollectionFromServerPath({
      creatorUserId: B,
      absolutePath: join(climateRoot, "climate.json"),
    }, { roots: climateRoots, database })).resolves.toMatchObject({ id: CLIMATE, scope: "system" });
  });

  it("never promotes manifests from user-controlled roots into system climate assets", async () => {
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: () => ({ returning: async () => [asset(CLIMATE, { ...value, id: CLIMATE, kind: "climate_collection" } as Partial<InputAssetRow>)] }) }) }),
    } as unknown as InputAssetDependencies["database"];
    await expect(registerSystemClimateCollectionFromServerPath({
      creatorUserId: A,
      absolutePath: join(root, "climate.json"),
    }, { roots: roots(), database })).rejects.toThrow("climate root");
  });

  it("requires every system climate member to use the manifest's approved root", async () => {
    const climateRoot = join(root, "Worldclim");
    await mkdir(climateRoot);
    const manifestPath = join(climateRoot, "climate.json");
    await writeFile(manifestPath, JSON.stringify({
      version: 1, metadata: { source: "worldclim" },
      members: [{ locator: "uploads/climate.tif", sha256: "10db699812d02cc570ad3bdef91138092088ff2718c1ef1d4ee308a89defe62a", size: 7, metadata: {} }],
    }));
    await expect(registerSystemClimateCollectionFromServerPath({
      creatorUserId: A,
      absolutePath: manifestPath,
    }, { roots: { ...roots(), worldclim: climateRoot }, database: fakeDatabase() })).rejects.toThrow("member root");
  });

  it("registers a server-produced v1 manifest only when every member identity is valid", async () => {
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: () => ({ returning: async () => [asset(CLIMATE, { ...value, id: CLIMATE, kind: "climate_collection", storageLocator: "uploads/climate.json" } as Partial<InputAssetRow>) ] }) }) }),
    } as unknown as InputAssetDependencies["database"];
    await expect(registerClimateCollectionFromServerPath({
      creatorUserId: A, scope: "private", absolutePath: join(root, "climate.json"),
    }, { roots: roots(), database })).resolves.toMatchObject({ kind: "climate_collection" });

    await writeFile(join(root, "climate.tif"), "tampered");
    await expect(registerClimateCollectionFromServerPath({
      creatorUserId: A, scope: "private", absolutePath: join(root, "climate.json"),
    }, { roots: roots(), database })).rejects.toThrow("manifest");
  });

  it("rechecks the manifest and every member before use", async () => {
    const manifestContent = await readFile(join(root, "climate.json"));
    const climate = asset(CLIMATE, { kind: "climate_collection", storageLocator: "uploads/climate.json", contentSha256: createHash("sha256").update(manifestContent).digest("hex"), contentSize: manifestContent.length });
    const resolved = await resolveInputAsset({ assetId: CLIMATE, principal: principal(A), action: "use" }, {
      roots: roots(), database: fakeDatabase({ assets: [climate] }),
    });
    expect(resolved).toMatchObject({ ok: true, absolutePath: join(root, "climate.json") });

    await writeFile(join(root, "climate.tif"), "tampered");
    const denied = await resolveInputAsset({ assetId: CLIMATE, principal: principal(A), action: "use" }, {
      roots: roots(), database: fakeDatabase({ assets: [climate] }),
    });
    expect(denied).toMatchObject({ ok: false, reason: "unsafe_storage" });
  });

  it("binds climate members to exact source roots instead of a broad data root", async () => {
    const climateRoot = join(root, "Worldclim");
    await mkdir(climateRoot, { recursive: true });
    await writeFile(join(climateRoot, "bio1.tif"), "climate");
    const manifestPath = join(climateRoot, "collection.json");
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      metadata: { source: "worldclim" },
      members: [{ locator: "worldclim/bio1.tif", sha256: "10db699812d02cc570ad3bdef91138092088ff2718c1ef1d4ee308a89defe62a", size: 7, metadata: { variable: "bio1" } }],
    }));
    const climateRoots = { worldclim: climateRoot, chelsa: join(root, "chelsa"), future_worldclim: join(root, "Worldclim_future") };
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: () => ({ returning: async () => [asset(CLIMATE, { ...value, id: CLIMATE, kind: "climate_collection" } as Partial<InputAssetRow>) ] }) }) }),
    } as unknown as InputAssetDependencies["database"];
    await expect(registerClimateCollectionFromServerPath({
      creatorUserId: A, scope: "private", absolutePath: manifestPath,
    }, { roots: climateRoots, database })).resolves.toMatchObject({ kind: "climate_collection" });
  });

  it("rejects directory and absolute-path member locators", async () => {
    await writeFile(join(root, "climate.json"), JSON.stringify({ version: 1, metadata: {}, members: [
      { locator: "/tmp/member.tif", sha256: "10db699812d02cc570ad3bdef91138092088ff2718c1ef1d4ee308a89defe62a", size: 7, metadata: {} },
    ] }));
    await expect(registerClimateCollectionFromServerPath({
      creatorUserId: A, scope: "private", absolutePath: join(root, "climate.json"),
    }, { roots: roots(), database: fakeDatabase() })).rejects.toThrow("manifest");

    await writeFile(join(root, "climate.json"), JSON.stringify({ version: 1, metadata: {}, members: [
      { locator: "uploads", sha256: "10db699812d02cc570ad3bdef91138092088ff2718c1ef1d4ee308a89defe62a", size: 7, metadata: {} },
    ] }));
    await expect(registerClimateCollectionFromServerPath({
      creatorUserId: A, scope: "private", absolutePath: join(root, "climate.json"),
    }, { roots: roots(), database: fakeDatabase() })).rejects.toThrow("manifest");
  });
});

describe("canonical input asset authorization", () => {
  it("allows only the private creator and audits a validated admin access", async () => {
    const privateAsset = asset(RAW);
    const dependencies = { roots: roots(), database: fakeDatabase({ assets: [privateAsset] }) };
    expect((await resolveInputAsset({ assetId: RAW, principal: principal(A), action: "use" }, dependencies)).ok).toBe(true);
    expect((await resolveInputAsset({ assetId: RAW, principal: principal(B), action: "use" }, { ...dependencies, database: fakeDatabase({ assets: [privateAsset] }) })).ok).toBe(false);

    const audit = vi.fn(async () => undefined);
    const admin = await resolveInputAsset({ assetId: RAW, principal: principal(G, "admin"), action: "use" }, {
      roots: roots(), database: fakeDatabase({ assets: [privateAsset] }), auditAdminAccess: audit,
    });
    expect(admin).toMatchObject({ ok: false, reason: "not_authorized" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("requires current membership for project assets and distinguishes read from use", async () => {
    const projectAsset = asset(RAW, { scope: "project", projectId: P });
    const read = await resolveInputAsset({ assetId: RAW, principal: principal(B), action: "read", destinationProjectId: P }, {
      roots: roots(), database: fakeDatabase({ assets: [projectAsset], membershipRole: "viewer" }),
    });
    expect(read.ok).toBe(true);
    const viewerUse = await resolveInputAsset({ assetId: RAW, principal: principal(B), action: "use", destinationProjectId: P }, {
      roots: roots(), database: fakeDatabase({ assets: [projectAsset], membershipRole: "viewer" }),
    });
    expect(viewerUse.ok).toBe(false);
    const editorUse = await resolveInputAsset({ assetId: RAW, principal: principal(B), action: "use", destinationProjectId: P }, {
      roots: roots(), database: fakeDatabase({ assets: [projectAsset], membershipRole: "editor" }),
    });
    expect(editorUse.ok).toBe(true);
    const revoked = await resolveInputAsset({ assetId: RAW, principal: principal(B), action: "read", destinationProjectId: P }, {
      roots: roots(), database: fakeDatabase({ assets: [projectAsset] }),
    });
    expect(revoked.ok).toBe(false);
  });

  it("governs system assets used by project runs through current destination membership", async () => {
    const systemAsset = asset(RAW, { scope: "system", projectId: null });
    const viewerUse = await resolveInputAsset({ assetId: RAW, principal: principal(B), action: "use", destinationProjectId: P }, {
      roots: roots(), database: fakeDatabase({ assets: [systemAsset], membershipRole: "viewer" }),
    });
    expect(viewerUse.ok).toBe(false);
    const editorUse = await resolveInputAsset({ assetId: RAW, principal: principal(B), action: "use", destinationProjectId: P }, {
      roots: roots(), database: fakeDatabase({ assets: [systemAsset], membershipRole: "editor" }),
    });
    expect(editorUse.ok).toBe(true);
    const revokedRead = await resolveInputAsset({ assetId: RAW, principal: principal(B), action: "read", destinationProjectId: P }, {
      roots: roots(), database: fakeDatabase({ assets: [systemAsset] }),
    });
    expect(revokedRead.ok).toBe(false);
  });

  it("rejects wrong kinds, deleted/quarantined assets, and private implicit sharing", async () => {
    const wrongKind = await resolveInputAsset({ assetId: RAW, principal: principal(A), expectedKind: "custom_boundary" }, {
      roots: roots(), database: fakeDatabase({ assets: [asset(RAW)] }),
    });
    expect(wrongKind).toMatchObject({ ok: false, reason: "invalid_asset" });
    for (const state of ["deleted", "quarantined"] as const) {
      const result = await resolveInputAsset({ assetId: RAW, principal: principal(A), action: "use" }, {
        roots: roots(), database: fakeDatabase({ assets: [asset(RAW, { state })] }),
      });
      expect(result.ok).toBe(false);
    }
    const creatorUseInProject = await resolveInputAsset({ assetId: RAW, principal: principal(A), action: "use", destinationProjectId: P }, {
      roots: roots(), database: fakeDatabase({ assets: [asset(RAW)] }),
    });
    expect(creatorUseInProject.ok).toBe(true);
  });

  it("requires an exact, ready parent for cleaned assets", async () => {
    const parent = asset(RAW, { storageLocator: "uploads/raw.csv" });
    const child = asset(CHILD, { kind: "cleaned_occurrence", storageLocator: "uploads/clean.csv", parentAssetId: RAW, contentSize: 5 });
    const ok = await resolveInputAsset({ assetId: CHILD, principal: principal(A), expectedKind: "cleaned_occurrence", expectedParentAssetId: RAW }, {
      roots: roots(), database: fakeDatabase({ assets: [child, parent] }),
    });
    expect(ok.ok).toBe(true);
    const mismatch = await resolveInputAsset({ assetId: CHILD, principal: principal(A), expectedParentAssetId: "00000000-0000-0000-0000-000000000999" }, {
      roots: roots(), database: fakeDatabase({ assets: [child] }),
    });
    expect(mismatch).toMatchObject({ ok: false, reason: "invalid_lineage" });
    const noParent = await resolveInputAsset({ assetId: CHILD, principal: principal(A) }, {
      roots: roots(), database: fakeDatabase({ assets: [asset(CHILD, { kind: "cleaned_occurrence", parentAssetId: null })] }),
    });
    expect(noParent).toMatchObject({ ok: false, reason: "invalid_lineage" });
  });

  it("fails closed on invalid principals, unsafe registry locators, and database failure", async () => {
    const invalidPrincipal = await resolveInputAsset({ assetId: RAW, principal: principal("not-a-uuid") }, {
      roots: roots(), database: fakeDatabase({ assets: [asset(RAW)] }),
    });
    expect(invalidPrincipal).toMatchObject({ ok: false, reason: "invalid_request" });
    const unsafe = await resolveInputAsset({ assetId: RAW, principal: principal(A), action: "use" }, {
      roots: roots(), database: fakeDatabase({ assets: [asset(RAW, { storageLocator: "/etc/passwd" })] }),
    });
    expect(unsafe).toMatchObject({ ok: false, reason: "unsafe_storage" });
    const misplacedBoundary = await resolveInputAsset({ assetId: RAW, principal: principal(A), action: "use", expectedKind: "custom_boundary" }, {
      roots: roots(), database: fakeDatabase({ assets: [asset(RAW, { kind: "custom_boundary", storageLocator: "uploads/asset.csv" })] }),
    });
    expect(misplacedBoundary).toMatchObject({ ok: false, reason: "unsafe_storage" });
    const unavailable = await resolveInputAsset({ assetId: RAW, principal: principal(A) }, {
      roots: roots(), database: fakeDatabase({ unavailable: true }),
    });
    expect(unavailable).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("does not turn ambiguous or quarantined legacy mappings into path access", async () => {
    const ambiguous = await resolveLegacyInputAsset("uploads", LEGACY, { principal: principal(A) }, {
      roots: roots(), database: fakeDatabase(),
    });
    expect(ambiguous).toMatchObject({ ok: false, reason: "legacy_unmapped" });
    const quarantined = await resolveLegacyInputAsset("uploads", LEGACY, { principal: principal(A) }, {
      roots: roots(), database: fakeDatabase({ mapping: { mappingState: "quarantined", inputAssetId: RAW } }),
    });
    expect(quarantined).toMatchObject({ ok: false, reason: "legacy_unmapped" });
  });
});

describe("server-only registration", () => {
  it("maps an actual producer path under the dedicated boundary root to an opaque asset locator", async () => {
    const boundaryRoot = await mkdtemp("/tmp/sdm-boundaries-");
    await mkdir(join(boundaryRoot, "custom"), { recursive: true });
    const boundaryPath = join(boundaryRoot, "custom", "boundary.geojson");
    await writeFile(boundaryPath, "{}");
    const uploadRoot = await mkdtemp("/tmp/sdm-uploads-");
    const systemRoot = await mkdtemp("/tmp/sdm-system-");
    const inserted: Record<string, unknown>[] = [];
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: () => ({ returning: async () => { inserted.push(value); return [value]; } }) }) }),
    } as unknown as InputAssetDependencies["database"];

    try {
      const registered = await registerInputAssetFromServerPath({
        creatorUserId: A,
        scope: "private",
        kind: "custom_boundary",
        absolutePath: boundaryPath,
      }, { roots: { uploads: uploadRoot, boundaries: boundaryRoot, system: systemRoot }, database });

      expect(registered.storageLocator).toBe("boundaries/custom/boundary.geojson");
      expect(inserted[0]?.kind).toBe("custom_boundary");
      await expect(registerInputAsset({
        creatorUserId: A,
        scope: "private",
        kind: "custom_boundary",
        root: "uploads",
        relativePath: "boundary.geojson",
      }, { roots: { uploads: uploadRoot, boundaries: boundaryRoot, system: systemRoot }, database })).rejects.toThrow("boundary root");
    } finally {
      await rm(boundaryRoot, { recursive: true, force: true });
      await rm(uploadRoot, { recursive: true, force: true });
      await rm(systemRoot, { recursive: true, force: true });
    }
  });

  it("issues a canonical locator, records content identity, and rejects system scope on generic registration", async () => {
    const inserted: Record<string, unknown>[] = [];
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: () => ({ returning: async () => { inserted.push(value); return [value]; } }) }) }),
    } as unknown as InputAssetDependencies["database"];
    const registered = await registerInputAsset({ creatorUserId: A, scope: "private", kind: "raw_occurrence", root: "uploads", relativePath: "asset.csv" }, { roots: roots(), database });
    expect(registered.storageLocator).toBe("uploads/asset.csv");
    expect(registered.contentSha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(inserted).toHaveLength(1);
    await expect(registerInputAsset({ creatorUserId: A, scope: "system", kind: "raw_occurrence", root: "system", relativePath: "asset.csv" } as never, { roots: roots(), database })).rejects.toBeInstanceOf(InputAssetRegistrationError);
  });

  it("permits an active editor to derive a project asset without forging the parent creator", async () => {
    const parent = asset(RAW, { creatorUserId: A, scope: "project", projectId: P, storageLocator: "uploads/raw.csv" });
    const created = asset(CHILD, { creatorUserId: B, scope: "project", projectId: P, kind: "cleaned_occurrence", parentAssetId: RAW, storageLocator: "uploads/clean.csv", contentSize: 5 });
    const database = {
      select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => table === inputAssets ? [parent] : table === projectMembers ? [{ role: "editor" }] : [] }) }) }),
      insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [created] }) }) }),
    } as unknown as InputAssetDependencies["database"];
    await expect(registerDerivedInputAsset({
      creatorUserId: B, actorUserId: B, scope: "project", projectId: P, kind: "cleaned_occurrence",
      parentAssetId: RAW, root: "uploads", relativePath: "clean.csv",
    }, { roots: roots(), database })).resolves.toMatchObject({ creatorUserId: B, parentAssetId: RAW });

    await expect(registerDerivedInputAsset({
      creatorUserId: B, actorUserId: B, scope: "private", kind: "cleaned_occurrence",
      parentAssetId: RAW, root: "uploads", relativePath: "clean.csv",
    }, { roots: roots(), database: fakeDatabase({ assets: [asset(RAW, { creatorUserId: A })] }) })).rejects.toThrow("Private parent asset");
  });

  it("binds system assets to the configured system root", async () => {
    await expect(registerSystemInputAsset({
      creatorUserId: A, kind: "raw_occurrence", root: "uploads", relativePath: "asset.csv",
    }, { roots: roots(), database: fakeDatabase() })).rejects.toThrow("configured system root");
  });

  it("returns an exact existing registration after a safe locator race", async () => {
    const existing = asset(RAW, { contentSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", contentSize: 3 });
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [existing] }) }) }),
      insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) }),
    } as unknown as InputAssetDependencies["database"];
    await expect(registerInputAsset({ creatorUserId: A, scope: "private", kind: "raw_occurrence", root: "uploads", relativePath: "asset.csv" }, { roots: roots(), database }))
      .resolves.toMatchObject({ id: RAW, storageLocator: "uploads/asset.csv" });
  });

  it("requires editor or admin membership to register project inputs", async () => {
    const makeRegistrationDatabase = (membershipRole: "admin" | "editor" | "viewer") => ({
      select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => table === projectMembers ? [{ role: membershipRole }] : [] }) }) }),
      insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: () => ({ returning: async () => [value] }) }) }),
    }) as unknown as InputAssetDependencies["database"];

    await expect(registerInputAsset({ creatorUserId: A, scope: "project", projectId: P, kind: "raw_occurrence", root: "uploads", relativePath: "asset.csv" }, {
      roots: roots(), database: makeRegistrationDatabase("viewer"),
    })).rejects.toThrow("cannot add project inputs");
    await expect(registerInputAsset({ creatorUserId: A, scope: "project", projectId: P, kind: "raw_occurrence", root: "uploads", relativePath: "asset.csv" }, {
      roots: roots(), database: makeRegistrationDatabase("editor"),
    })).resolves.toMatchObject({ scope: "project", projectId: P });
  });
});
