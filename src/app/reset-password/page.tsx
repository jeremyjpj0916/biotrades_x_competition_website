import { headers } from "next/headers";
import { turnstile } from "@/lib/config";
import { AuthForm } from "@/components/account-forms";
import { PageHeading } from "@/components/ui";
import type { SearchParams } from "@/components/competition-pages";
export const metadata = { title: "Reset password", robots: { index: false } };
export default async function Reset({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { token } = await searchParams;
  return (
    <div className="page">
      <PageHeading title="Reset password" />
      <AuthForm
        initial={typeof token === "string" ? "reset" : "forgot"}
        token={typeof token === "string" ? token : undefined}
        siteKey={turnstile.siteKey}
        nonce={(await headers()).get("x-nonce") ?? undefined}
        providers={{ discord: false, twitter: false }}
      />
    </div>
  );
}
