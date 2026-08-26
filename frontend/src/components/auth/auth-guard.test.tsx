import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import { AuthGuard } from "./auth-guard";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("GG-01: AuthGuard hydration race fix", () => {
  beforeEach(() => {
    pushMock.mockClear();
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

  it("renders children immediately when token is present and persist has already hydrated (jsdom default)", async () => {
    // In jsdom, Zustand persist rehydrates synchronously during store
    // creation, so hasHydrated() returns true from the first render. The
    // guard must render children (not redirect) when a token exists.
    useAuthStore.setState({
      user: { id: "u1", email: "u@x.test", name: null, role: "user", avatarUrl: null, bio: null, organization: null, lastLoginAt: null, createdAt: null },
      token: "valid-token",
      project: null,
      projects: [],
      error: null,
    });

    render(
      <AuthGuard>
        <div data-testid="protected">protected</div>
      </AuthGuard>,
    );

    expect(screen.getByTestId("protected")).not.toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when hydrated and no token is available anywhere", async () => {
    render(
      <AuthGuard>
        <div data-testid="protected">protected</div>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("honours a token stored in localStorage (cookie-style) when the Zustand store has none", async () => {
    // The auth store's partialize excludes token, so after rehydration the
    // store's `token` is null but `getAuthToken()` still reads the
    // localStorage fallback. The guard must accept the localStorage token.
    localStorage.setItem("sdm_token", "cookie-fallback-token");

    render(
      <AuthGuard>
        <div data-testid="protected">protected</div>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("protected")).not.toBeNull();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
