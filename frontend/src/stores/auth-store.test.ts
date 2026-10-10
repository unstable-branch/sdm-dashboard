import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "./auth-store";

const user = { id: "user-1", email: "release@example.test", name: "Release QA", role: "user", avatarUrl: null, bio: null, organization: null, lastLoginAt: null, createdAt: null };

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  document.cookie = "sdm_token=; Path=/; Max-Age=0";
  useAuthStore.setState({ user: null, project: null, projects: [], error: null, status: "unknown" });
});

describe("metadata-only auth state", () => {
  it("stores user metadata and never persists or exposes a browser token", () => {
    localStorage.setItem("sdm_token", "legacy-secret");
    useAuthStore.getState().setAuth(user);
    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect("token" in useAuthStore.getState()).toBe(false);
    expect(localStorage.getItem("sdm_token")).toBeNull();
    expect(sessionStorage.getItem("sdm_token")).toBeNull();
    expect(localStorage.getItem("sdm-auth")).not.toContain("legacy-secret");
    expect(document.cookie).not.toContain("sdm_token");
  });

  it("keeps user metadata on transient auth outage", () => {
    useAuthStore.getState().setAuth(user);
    useAuthStore.getState().setStatus("unavailable");
    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().status).toBe("unavailable");
  });

  it("clears identity only when explicitly signed out", () => {
    useAuthStore.getState().setAuth(user);
    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().status).toBe("signed-out");
  });
});
