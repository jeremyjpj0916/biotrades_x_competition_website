export const appUrl = process.env.APP_URL || "http://localhost:3000";
export const firstYear = Number(process.env.FIRST_COMPETITION_YEAR || 2027);
export const community = {
  discord: process.env.DISCORD_COMMUNITY_URL,
  x: process.env.X_COMMUNITY_URL,
};
export const providers = {
  discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
  twitter: Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),
};

export const marketMode = process.env.MARKET_DATA_MODE === "official" ? "official" : "free";

const local =
  process.env.NODE_ENV !== "production" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(appUrl).hostname);
const dummySiteKey = "1x00000000000000000000AA";
const dummySecret = "1x0000000000000000000000000000000AA";
const siteKey = process.env.TURNSTILE_SITE_KEY || (local ? dummySiteKey : "");
const secretKey = process.env.TURNSTILE_SECRET_KEY || (local ? dummySecret : "");
const dummyInProduction = !local && (/^[123]x0{8}/.test(siteKey) || /^[123]x0{8}/.test(secretKey));
export const turnstile = {
  siteKey: !dummyInProduction && siteKey && secretKey ? siteKey : "",
  secretKey: !dummyInProduction && siteKey && secretKey ? secretKey : "",
  allowedHostnames: local && siteKey === dummySiteKey ? undefined : [new URL(appUrl).hostname],
};
export const protectedAuthPaths = [
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/social",
  "/request-password-reset",
  "/send-verification-email",
];
