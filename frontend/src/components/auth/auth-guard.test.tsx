import { act, render, screen, waitFor } from "@testing-library/react";
import { vi, beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import { AuthGuard } from "./auth-guard";
import { ApiError, ApiUnavailableError } from "@/services/api";
import { announceLogoutPending, publishLogoutFinished, withSessionMutation } from "@/services/session-coordinator";
const pushMock = vi.fn(); const apiGetMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/services/api", async (original) => ({ ...(await original<typeof import("@/services/api")>()), apiGet: (...args: unknown[]) => apiGetMock(...args) }));
const user = { id: "u1", email: "u@x.test", name: null, role: "user", avatarUrl: null, bio: null, organization: null, lastLoginAt: null, createdAt: null };
const publishConfirmedFinish = () => withSessionMutation(async () => publishLogoutFinished(true));

describe("AuthGuard verifies persisted metadata with /me", () => {
  beforeEach(() => { pushMock.mockClear(); apiGetMock.mockReset(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback() } }); localStorage.clear(); sessionStorage.clear(); useAuthStore.setState({ user: null, project: null, projects: [], error: null, status: "unknown" }); });
  it("checks /me before displaying a cached user", async () => {
    useAuthStore.setState({ user, status: "unknown" }); apiGetMock.mockResolvedValue(user);
    render(<AuthGuard><div data-testid="protected">secret</div></AuthGuard>);
    expect(screen.queryByTestId("protected")).toBeNull(); await screen.findByTestId("protected");
    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/auth/me");
  });
  it("revalidates current identity when another tab changes the session", async () => {
    const nextUser = { ...user, id: "u2", email: "next@example.test" };
    apiGetMock.mockResolvedValueOnce(user).mockResolvedValueOnce(nextUser);
    render(<AuthGuard><div data-testid="protected">secret</div></AuthGuard>);
    await screen.findByTestId("protected");
    await waitFor(() => expect(apiGetMock).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new CustomEvent("sdm:session-changed")));
    await waitFor(() => expect(apiGetMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useAuthStore.getState().user).toEqual(nextUser));
  });

  it("hides children during logout-pending and revalidates when logout fails", async () => {
    useAuthStore.setState({ user, status: "authenticated" });
    apiGetMock.mockResolvedValue(user);
    render(<AuthGuard><div data-testid="protected">secret</div></AuthGuard>);
    await screen.findByTestId("protected");
    act(() => announceLogoutPending());
    await screen.findByRole("alert");
    expect(screen.queryByTestId("protected")).toBeNull();
    await act(async () => { await publishConfirmedFinish(); });
    await screen.findByTestId("protected");
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it("does not request or expose /me while persisted logout intent is pending", async () => {
    useAuthStore.setState({ user, status: "authenticated" });
    localStorage.setItem("sdm-browser-session-revision", JSON.stringify({ revision: 900001, kind: "logout-pending" }));
    announceLogoutPending();
    const apiGetSpy = apiGetMock;
    apiGetSpy.mockResolvedValue(user);
    render(<AuthGuard><div data-testid="protected">secret</div></AuthGuard>);
    await waitFor(() => expect(useAuthStore.getState().status).toBe("unavailable"));
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("protected")).toBeNull();
    await publishConfirmedFinish();
  });

  it("does not authenticate from /me when logout becomes pending before it resolves", async () => {
    let finishMe!: (value: typeof user) => void;
    apiGetMock.mockImplementation(() => new Promise((resolve) => { finishMe = resolve; }));
    render(<AuthGuard><div data-testid="protected">secret</div></AuthGuard>);
    await waitFor(() => expect(apiGetMock).toHaveBeenCalledTimes(1));
    announceLogoutPending();
    finishMe({ ...user, id: "old-principal" });
    await waitFor(() => expect(useAuthStore.getState().status).toBe("unavailable"));
    expect(useAuthStore.getState().user?.id).not.toBe("old-principal");
    expect(screen.queryByTestId("protected")).toBeNull();
    await publishConfirmedFinish();
  });

  it("preserves the user while a peer logout is pending and /me returns 401", async () => {
    useAuthStore.setState({ user, status: "unknown" });
    apiGetMock.mockRejectedValue(new ApiError(401, "Unauthorized"));
    announceLogoutPending();
    render(<AuthGuard><div data-testid="protected">secret</div></AuthGuard>);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeTruthy();
    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().status).toBe("unavailable");
    await publishConfirmedFinish();
  });

  it("redirects after a confirmed 401", async () => {
    apiGetMock.mockRejectedValue(new ApiError(401, "Unauthorized"));
    render(<AuthGuard><div data-testid="protected">secret</div></AuthGuard>);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login")); expect(useAuthStore.getState().status).toBe("signed-out");
  });
  it("preserves stale user metadata and offers retry on outage", async () => {
    useAuthStore.setState({ user, status: "unknown" }); apiGetMock.mockRejectedValue(new ApiUnavailableError());
    render(<AuthGuard><div data-testid="protected">secret</div></AuthGuard>);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeTruthy();
    expect(useAuthStore.getState().user).toEqual(user); expect(pushMock).not.toHaveBeenCalled();
  });
});
