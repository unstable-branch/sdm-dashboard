import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads dashboard page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/SDM/);
  });

  test("shows project stats or empty state", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/SDM Dashboard|project|occurrence|species/i).first()).toBeVisible();
  });
});

test.describe("Navigation", () => {
  test("sidebar navigation renders", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Model|model/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Data|data/i }).first()).toBeVisible();
  });
});

test.describe("Data Page", () => {
  test("loads data page with tabs", async ({ page }) => {
    await page.goto("/data");
    await expect(page.getByRole("tab", { name: /Upload/i }).or(page.getByText(/Upload/i).first())).toBeVisible();
    await expect(page.getByRole("tab", { name: /GBIF/i }).or(page.getByText(/GBIF/i).first())).toBeVisible();
  });

  test("upload section is accessible", async ({ page }) => {
    await page.goto("/data");
    await page.getByRole("tab", { name: /Upload/i }).click();
    await expect(page.getByText(/file|CSV|data/i).first()).toBeVisible();
  });
});

test.describe("Model Page", () => {
  test("loads model configuration form", async ({ page }) => {
    await page.goto("/model");
    await expect(page.getByText(/Model|Species|Configuration/i).first()).toBeVisible();
  });
});

test.describe("Results Page", () => {
  test("shows empty state or runs list", async ({ page }) => {
    await page.goto("/results");
    await expect(page.getByText(/results|runs|no|completed/i).first()).toBeVisible();
  });
});

test.describe("Batch page redirects to data page", () => {
  test("redirects /batch to /data?tab=batch", async ({ page }) => {
    await page.goto("/batch");
    await page.waitForURL(/\/data/);
    await expect(page).toHaveURL(/\/data/);
  });
});
