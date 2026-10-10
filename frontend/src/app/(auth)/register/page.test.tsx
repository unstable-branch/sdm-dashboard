import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "./page";
import { registerBrowserSession } from "@/services/api";
import { useAuthStore } from "@/stores/auth-store";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/services/api", () => ({ registerBrowserSession: vi.fn() }));
const user = { id: "u1", email: "qa@example.test", name: "QA", role: "user", avatarUrl: null, bio: null, organization: null, lastLoginAt: null, createdAt: null };
describe("RegisterPage browser session", () => {
  beforeEach(() => { push.mockClear(); vi.mocked(registerBrowserSession).mockReset(); useAuthStore.setState({ user: null, project: null, projects: [], status: "unknown", error: null }); });
  it("submits browser-session and remember metadata without a token response", async () => {
    vi.mocked(registerBrowserSession).mockResolvedValue({ user });
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "QA" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-fixture-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "synthetic-fixture-password" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => expect(registerBrowserSession).toHaveBeenCalledWith("/api/v1/auth/register", { name: "QA", email: user.email, password: "synthetic-fixture-password", remember_me: true }));
    expect(useAuthStore.getState().user).toEqual(user);
    expect("token" in useAuthStore.getState()).toBe(false);
    expect(push).toHaveBeenCalledWith("/");
  });
});
