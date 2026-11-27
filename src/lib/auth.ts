import { betterAuth } from "better-auth";
import { captcha } from "better-auth/plugins";
import { appUrl, providers, protectedAuthPaths, turnstile } from "./config";
import { pool } from "./db";
import { sendMail } from "./mail";

export const auth = betterAuth({
  appName: "BioTrades X",
  baseURL: appUrl,
  secret:
    process.env.BETTER_AUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "biotrades-development-secret-never-use-in-production"
      : undefined),
  database: pool,
  plugins: turnstile.secretKey
    ? [
        captcha({
          provider: "cloudflare-turnstile",
          secretKey: turnstile.secretKey,
          endpoints: protectedAuthPaths,
          allowedHostnames: turnstile.allowedHostnames,
        }),
      ]
    : [],
  disabledPaths: turnstile.secretKey ? [] : protectedAuthPaths,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      void sendMail(user.email, "Reset your BioTrades X password", url).catch(() =>
        console.error("Password reset mail delivery failed"),
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(user.email, "Verify your BioTrades X account", url);
    },
  },
  user: {
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }) => {
        await sendMail(user.email, "Confirm deletion of your BioTrades X account", url);
      },
    },
  },
  socialProviders: {
    ...(providers.discord && {
      discord: { clientId: process.env.DISCORD_CLIENT_ID!, clientSecret: process.env.DISCORD_CLIENT_SECRET! },
    }),
    ...(providers.twitter && {
      twitter: { clientId: process.env.X_CLIENT_ID!, clientSecret: process.env.X_CLIENT_SECRET! },
    }),
  },
  account: {
    encryptOAuthTokens: true,
    accountLinking: { enabled: true, disableImplicitLinking: true },
  },
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
  advanced: {
    useSecureCookies: appUrl.startsWith("https://"),
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
});
