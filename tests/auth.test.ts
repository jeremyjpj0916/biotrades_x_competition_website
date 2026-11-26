import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("email authentication", () => {
  it("requires a challenge, verifies email, authenticates a new session and rejects unauthenticated admin access", async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.APP_URL = "http://localhost:3000";
    delete process.env.SMTP_URL;
    const { auth } = await import("../src/lib/auth");
    const { pool } = await import("../src/lib/db");
    const { POST: admin } = await import("../src/app/api/admin/route");
    const realFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: RequestInfo | URL, input?: RequestInit) => {
      if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
        return Response.json({ success: true, hostname: "example.com" });
      }
      return realFetch(url, input);
    });
    vi.stubGlobal("fetch", fetchMock);
    let activationLink = "";
    const capture = vi.spyOn(console, "info").mockImplementation((title, _to, subject, link) => {
      if (title === "Development mail:" && String(subject).startsWith("Verify"))
        activationLink = String(link);
    });
    const email = `test-${randomUUID()}@example.test`;
    const password = "Automated-local-test-password-321!";
    const request = (route: string, body: unknown, challenge?: string) =>
      new Request(`http://localhost:3000/api/auth/${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
          "x-forwarded-for": "127.0.0.1",
          ...(challenge ? { "x-captcha-response": challenge } : {}),
        },
        body: JSON.stringify(body),
      });
    try {
      const signup = { email, password, name: "Synthetic Player", callbackURL: "/account" };
      const challenge = "fixture-token-for-mocked-siteverify";
      const missing = await auth.handler(request("sign-up/email", signup));
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({ code: "MISSING_RESPONSE" });
      const created = await auth.handler(request("sign-up/email", signup, challenge));
      expect(created.status).toBe(200);
      expect(activationLink).toContain("/api/auth/verify-email");
      const denied = await auth.handler(request("sign-in/email", { email, password }, challenge));
      expect(denied.status).toBe(403);
      const verified = await auth.handler(new Request(activationLink));
      expect(verified.status).toBe(302);
      const loggedIn = await auth.handler(request("sign-in/email", { email, password }, challenge));
      expect(loggedIn.status).toBe(200);
      const cookie = loggedIn.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toBeTruthy();
      const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie! }) });
      expect(session?.user).toMatchObject({ email, emailVerified: true });
      expect(
        await admin(
          new Request("http://localhost:3000/api/admin", {
            method: "POST",
            headers: { origin: "http://localhost:3000" },
          }),
        ),
      ).toMatchObject({ status: 403 });
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      await pool.query('DELETE FROM "user" WHERE email=$1', [email]);
      capture.mockRestore();
      vi.unstubAllGlobals();
      await pool.end();
    }
  });
});
