import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const primaryRoutes = [
  "/",
  "/projects",
  "/data",
  "/model",
  "/evaluate",
  "/ecology",
  "/downloads",
  "/settings",
  "/results",
];

async function assertApplicationPage(page: Page, route: string) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response, `${route} should return a response`).not.toBeNull();
  expect(
    response?.status(),
    `${route} should not return a server error`,
  ).toBeLessThan(500);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.locator("body")).not.toContainText("Internal Server Error");
  await expect(page.locator("body")).not.toContainText("Application error");
}

test.describe.serial("release stack smoke", () => {
  let context: BrowserContext;
  let page: Page;
  let email: string;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    email = `release-${Date.now()}-${test.info().project.name.replace(/\W+/g, "-")}@example.test`;
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("fresh database supports registration and authenticated startup", async () => {
    await page.goto("/register", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Name").fill("Release QA");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Release-QA-2026!");
    await page.getByLabel("Confirm password").fill("Release-QA-2026!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: /dashboard/i }),
    ).toBeVisible();
  });

  test("primary authenticated routes render without server failures", async () => {
    for (const route of primaryRoutes) {
      await assertApplicationPage(page, route);
    }
  });

  test("mobile navigation opens and has a visible close control", async ({
    browser,
  }) => {
    const storageState = await context.storageState();
    const mobileContext = await browser.newContext({
      storageState,
      viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobileContext.newPage();

    await assertApplicationPage(mobilePage, "/");
    const open = mobilePage.getByRole("button", {
      name: "Open navigation menu",
    });
    await expect(open).toBeVisible();
    await open.click();
    const close = mobilePage
      .getByRole("complementary", { name: "Main navigation" })
      .getByRole("button", { name: "Close navigation menu" });
    await expect(close).toBeVisible();
    await close.click();
    await expect(
      mobilePage.getByRole("button", { name: "Open navigation menu" }),
    ).toBeVisible();

    await mobileContext.close();
  });
});
