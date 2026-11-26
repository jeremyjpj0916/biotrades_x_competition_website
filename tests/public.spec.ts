import { test, expect } from "@playwright/test";
import { useTurnstileFixture } from "./support/turnstile";
test("opens season pages, joins and switches color theme", async ({ page, isMobile }) => {
  await useTurnstileFixture(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "One pick. One trading year." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Season timeline" })).toBeVisible();
  const theme = page.getByRole("button", { name: "Switch to light mode" });
  await expect(theme).toBeVisible();
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Full leaderboard" }).click();
  await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { name: "Season analytics" })).toBeVisible();
  await page.getByRole("navigation", { name: "Season pages" }).getByRole("link", { name: "Rules" }).click();
  await expect(page.getByRole("heading", { name: "Competition rules" })).toBeVisible();
  await page.getByRole("link", { name: "Join competition", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Join BioTrades X" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create your account", exact: true })).toBeEnabled({
    timeout: 15000,
  });
  await expect(page.getByText("No real-money trades", { exact: false })).toHaveCount(0);
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("test-password-only");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("test-password-only");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Forgot password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled({ timeout: 15000 });
});
