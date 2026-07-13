import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "./auth-store";

const user = {
  id: "user-1",
  email: "release@example.test",
  name: "Release QA",
  role: "user",
  avatarUrl: null,
  bio: null,
  organization: null,
  lastLoginAt: null,
  createdAt: null,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "sdm_token=; Path=/; Max-Age=0";
  useAuthStore.setState({
    user: null,
    token: null,
    project: null,
    projects: [],
    error: null,
  });
});

describe("auth token persistence", () => {
  it("uses session storage when remember me is disabled", () => {
    useAuthStore.getState().setAuth(user, "session-token", false);

    expect(sessionStorage.getItem("sdm_token")).toBe("session-token");
    expect(localStorage.getItem("sdm_token")).toBeNull();
    expect(localStorage.getItem("sdm-auth")).not.toContain("session-token");
  });

  it("uses local storage by default", () => {
    useAuthStore.getState().setAuth(user, "persistent-token");

    expect(localStorage.getItem("sdm_token")).toBe("persistent-token");
    expect(sessionStorage.getItem("sdm_token")).toBeNull();
  });
});
