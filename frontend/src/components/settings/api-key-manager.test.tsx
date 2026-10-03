import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiDelete, apiGet } from "@/services/api";
import { ApiKeyManager } from "./api-key-manager";
vi.mock("@/services/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
describe("ApiKeyManager cookie auth", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.mocked(apiGet).mockResolvedValue([{ id: "k1", name: "CI", createdAt: "2026-01-01", lastUsedAt: null, expiresAt: null }]); vi.mocked(apiDelete).mockReset(); });
  it("loads API keys without a JavaScript token", async () => {
    render(<ApiKeyManager />);
    expect(await screen.findByText("CI")).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith("/api/v1/auth/api-keys");
  });
  it("keeps a key listed and displays deletion failures", async () => {
    vi.mocked(apiDelete).mockRejectedValue(new Error("service unavailable"));
    render(<ApiKeyManager />);
    await screen.findByText("CI");
    fireEvent.click(screen.getByRole("button", { name: "Delete API key CI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to delete/i);
    expect(screen.getByText("CI")).toBeTruthy();
  });
});
