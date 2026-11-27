import type { Page } from "@playwright/test";

export async function useTurnstileFixture(page: Page) {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile = {
        render(host, options) {
          host.textContent = "Test verification";
          queueMicrotask(() => options.callback("browser-fixture-token"));
          return "test-widget";
        },
        remove() {},
        reset() {}
      };`,
    }),
  );
}
