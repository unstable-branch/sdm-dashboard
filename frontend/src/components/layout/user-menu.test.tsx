import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import { UserMenu } from "./user-menu";
import { logoutBrowserSession } from "@/services/api";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/services/api", async (original) => ({ ...(await original<typeof import("@/services/api")>()), logoutBrowserSession: vi.fn() }));
const user = { id: "u1", email: "user@example.test", name: "Tester", role: "user", avatarUrl: null, bio: null, organization: null, lastLoginAt: null, createdAt: null };
describe("UserMenu browser logout", () => {
  beforeEach(() => { vi.mocked(logoutBrowserSession).mockReset(); useAuthStore.setState({ user, project: null, projects: [], status: "authenticated", error: null }); });
  it("preserves the signed-in user and reports server revocation failure", async () => {
    vi.mocked(logoutBrowserSession).mockRejectedValue(new Error("service unavailable"));
    render(<UserMenu />);
    fireEvent.click(screen.getByRole("button", { name: /tester/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/sign out failed/i);
    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().status).toBe("authenticated");
  });
});
