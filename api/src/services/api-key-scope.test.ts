import { describe, expect, it } from "vitest";
import { apiKeyScopeAllows } from "./auth-principal.js";

const jwtPrincipal = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "[EMAIL]",
  role: "editor" as const,
  authVersion: 0,
  source: "jwt" as const,
};

const unscopedKey = {
  ...jwtPrincipal,
  source: "api-key" as const,
  scopeProjectId: null,
};

const scopedKeyInProject = (projectId: string) => ({
  ...unscopedKey,
  scopeProjectId: projectId,
});

describe("apiKeyScopeAllows", () => {
  it("lets JWT principals act in any project (scope is an API-key concept)", () => {
    expect(apiKeyScopeAllows(jwtPrincipal, "ffffffff-0000-0000-0000-000000000099")).toBe(true);
    expect(apiKeyScopeAllows(jwtPrincipal, null)).toBe(true);
  });

  it("lets unscoped API keys act in any project (backward compatibility)", () => {
    expect(apiKeyScopeAllows(unscopedKey, "ffffffff-0000-0000-0000-000000000099")).toBe(true);
    expect(apiKeyScopeAllows(unscopedKey, null)).toBe(true);
  });

  it("allows a scoped key only inside its bound project", () => {
    const inScope = "aaaaaaaa-0000-0000-0000-000000000001";
    const key = scopedKeyInProject(inScope);
    expect(apiKeyScopeAllows(key, inScope)).toBe(true);
  });

  it("denies a scoped key on any other project", () => {
    const key = scopedKeyInProject("aaaaaaaa-0000-0000-0000-000000000001");
    expect(apiKeyScopeAllows(key, "aaaaaaaa-0000-0000-0000-000000000002")).toBe(false);
  });

  it("denies a scoped key on private (null-project) resources", () => {
    const key = scopedKeyInProject("aaaaaaaa-0000-0000-0000-000000000001");
    expect(apiKeyScopeAllows(key, null)).toBe(false);
    expect(apiKeyScopeAllows(key, undefined)).toBe(false);
    expect(apiKeyScopeAllows(key, "")).toBe(false);
  });

  it("denies closed on malformed scope comparisons", () => {
    const key = scopedKeyInProject("aaaaaaaa-0000-0000-0000-000000000001");
    // Non-UUID projectId can never match the bound scope.
    expect(apiKeyScopeAllows(key, "../../etc/passwd")).toBe(false);
    expect(apiKeyScopeAllows(key, 123 as unknown as string)).toBe(false);
  });
});
