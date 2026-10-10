import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";
import { loginBrowserSession, registerBrowserSession } from "@/services/api";
import { useAuthStore } from "@/stores/auth-store";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("redirect=%2Fresults%3Ftab%3Drecent") }));
vi.mock("@/services/api", () => ({ loginBrowserSession: vi.fn(), registerBrowserSession: vi.fn() }));
const user = { id: "u1", email: "qa@example.test", name: "QA", role: "user", avatarUrl: null, bio: null, organization: null, lastLoginAt: null, createdAt: null };
describe("LoginPage browser session", () => {
  beforeEach(() => { push.mockClear(); vi.mocked(loginBrowserSession).mockReset(); vi.mocked(registerBrowserSession).mockReset(); useAuthStore.setState({ user: null, project: null, projects: [], status: "unknown", error: null }); });
  it("submits remember choice, stores metadata only, and preserves safe local redirect", async () => {
    vi.mocked(loginBrowserSession).mockResolvedValue({ user });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "fixture-password" } });
    fireEvent.click(screen.getByLabelText(/remember me/i));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(loginBrowserSession).toHaveBeenCalledWith("/api/v1/auth/login", { email: user.email, password: "fixture-password", remember_me: false }));
    expect(useAuthStore.getState().user).toEqual(user);
    expect("token" in useAuthStore.getState()).toBe(false);
    expect(push).toHaveBeenCalledWith("/results?tab=recent");
  });
});
