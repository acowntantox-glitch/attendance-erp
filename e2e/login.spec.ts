import { expect, test } from "@playwright/test";

/**
 * Requires the app to be running against a seeded database (`pnpm db:seed`).
 * Uses the development-only seed credentials — see scripts/seed.ts.
 */
test.describe("authentication", () => {
  test("redirects an unauthenticated visitor to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows an error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@acme.dev");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("logs in with seeded company admin credentials and reaches the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@acme.dev");
    await page.getByLabel("Password").fill("DevPassword123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("logs out and returns to the login page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@acme.dev");
    await page.getByLabel("Password").fill("DevPassword123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
