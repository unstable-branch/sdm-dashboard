import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads dashboard page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/SDM/);
  });

  test("shows service status cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Plumber/i)).toBeVisible();
    await expect(page.getByText(/Redis/i)).toBeVisible();
    await expect(page.getByText(/PostgreSQL/i)).toBeVisible();
  });

  test("shows latest run metrics if available", async ({ page }) => {
    await page.goto("/");
    const metricsSection = page.getByText(/Latest Run/i);
    if (await metricsSection.isVisible()) {
      await expect(page.getByText(/AUC/i)).toBeVisible();
    }
  });
});

test.describe("Navigation", () => {
  test("sidebar links navigate correctly", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /Model/i }).click();
    await expect(page).toHaveURL(/\/model/);

    await page.getByRole("link", { name: /Data/i }).click();
    await expect(page).toHaveURL(/\/data/);

    await page.getByRole("link", { name: /Results/i }).toBeVisible();
  });
});

test.describe("Data Page", () => {
  test("loads data page with tabs", async ({ page }) => {
    await page.goto("/data");
    await expect(page.getByRole("tab", { name: /Upload/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /GBIF/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /DwC-A/i })).toBeVisible();
  });

  test("upload tab shows file drop zone", async ({ page }) => {
    await page.goto("/data");
    await page.getByRole("tab", { name: /Upload/i }).click();
    await expect(page.getByText(/Drop your occurrence file/i)).toBeVisible();
  });
});

test.describe("Model Page", () => {
  test("loads model configuration form", async ({ page }) => {
    await page.goto("/model");
    await expect(page.getByText(/Model Configuration/i)).toBeVisible();
    await expect(page.getByLabel(/Species/i)).toBeVisible();
    await expect(page.getByLabel(/Model/i)).toBeVisible();
  });
});

test.describe("Results Page", () => {
  test("shows empty state when no runs", async ({ page }) => {
    await page.goto("/results");
    await expect(page.getByText(/No runs yet/i)).toBeVisible();
  });
});
