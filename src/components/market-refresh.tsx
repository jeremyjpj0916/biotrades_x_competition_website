"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function MarketRefresh({ year, publication }: { year: number; publication: string | null }) {
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    let lastSeen = publication;

    async function checkPublication() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch(`/api/market-publication?year=${year}`, {
          credentials: "omit",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const { publication: current } = (await response.json()) as { publication: string | null };
        if (current !== lastSeen && !controller.signal.aborted) {
          lastSeen = current;
          router.refresh();
        }
      } catch {
        // Keep the current snapshot until another check can reach the site.
      } finally {
        checking = false;
      }
    }

    const timer = setInterval(checkPublication, 60000);
    document.addEventListener("visibilitychange", checkPublication);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", checkPublication);
    };
  }, [publication, router, year]);

  return null;
}
