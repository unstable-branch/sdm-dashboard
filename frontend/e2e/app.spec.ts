import { test, expect } from "@playwright/test";

test("login page loads", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Sign in to your account")).toBeVisible({ timeout: 10000 });
});
