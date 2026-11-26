import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/config";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/admin", "/join", "/api", "/reset-password"],
    },
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
