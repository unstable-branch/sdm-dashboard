import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test("loads login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Sign in to your account")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Dashboard redirects to login", () => {
  test("redirects unauthenticated user to login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("/login");
  });
});
