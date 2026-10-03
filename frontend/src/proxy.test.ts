import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { proxy } from "./proxy";
function request(path: string, cookies: string[] = []) {
  const url = new URL(path, "https://app.example.test");
  return { url: url.toString(), nextUrl: url, cookies: { get: (name: string) => cookies.includes(name) ? { name, value: "present" } : undefined } } as unknown as NextRequest;
}
describe("proxy browser-session navigation hint", () => {
  it.each(["sdm_token", "__Host-sdm_token", "sdm_refresh_token", "__Host-sdm_refresh_token"])("allows navigation when %s is present", (name) => {
    expect(proxy(request("/models?tab=active", [name]))?.status).toBe(200);
  });
  it("keeps pathname and query in login redirect when cookies are absent", () => {
    const response = proxy(request("/models?tab=active&sort=name"));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toContain("redirect=%2Fmodels%3Ftab%3Dactive%26sort%3Dname");
  });
});
