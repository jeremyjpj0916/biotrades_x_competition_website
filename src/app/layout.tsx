import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { Brand, Navigation } from "@/components/chrome";
import { appUrl, community } from "@/lib/config";
import { session } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "BioTrades X | Annual Biotech Stock Competition", template: "%s | BioTrades X" },
  description:
    "Pick one biotech stock and see how it stacks up over a trading year in the BioTrades X community competition.",
  openGraph: { type: "website", siteName: "BioTrades X", images: ["/art/biotech-helix.webp"] },
  icons: { icon: "/art/biotrades-mark.png" },
};
function communityUrl(value: string | undefined) {
  return value && /^https:\/\//.test(value) ? value : null;
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  const current = await session().catch(() => null);
  return (
    <html lang="en" data-theme={theme} data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Navigation theme={theme} authenticated={Boolean(current)} />
        <main id="main" className="wrap">
          {children}
        </main>
        <footer className="site-footer">
          <div className="wrap footer-inner">
            <div>
              <Brand />
              <p>Annual biotech stock-picking competition</p>
            </div>
            <nav aria-label="Footer">
              <Link href="/rules">Competition rules</Link>
              <Link href="/history">Season archive</Link>
              {communityUrl(community.discord) && (
                <a href={community.discord}>
                  Discord <ArrowUpRight size={14} />
                </a>
              )}
              {communityUrl(community.x) && (
                <a href={community.x}>
                  X <ArrowUpRight size={14} />
                </a>
              )}
            </nav>
            <span className="footer-note">Free to enter.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
