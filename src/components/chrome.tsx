"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dna, Menu, X, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { ThemeButton } from "./theme";

const links = [
  ["Overview", "/"],
  ["Leaderboard", "/leaderboard"],
  ["Analytics", "/analytics"],
  ["Stock Picks", "/stocks"],
  ["Hall of Fame", "/hall-of-fame"],
  ["History", "/history"],
  ["Rules", "/rules"],
];
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="BioTrades X home">
      <span className="brand-icon">
        <Dna size={22} strokeWidth={2.2} />
      </span>
      <span>
        BioTrades<span className="brand-x"> X</span>
      </span>
    </Link>
  );
}
export function Navigation({ theme, authenticated }: { theme: string; authenticated: boolean }) {
  const current = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="nav-inner wrap">
        <Brand />
        <nav
          className={`primary-nav ${open ? "menu-open" : ""}`}
          id="primary-navigation"
          aria-label="Primary"
        >
          {links.map(([name, href]) => {
            const active =
              href === "/"
                ? current === "/"
                : current.startsWith(href) || current.includes(`${href}/`) || current.endsWith(href);
            return (
              <Link
                key={href}
                className={active ? "current" : ""}
                aria-current={active ? "page" : undefined}
                href={href}
                onClick={() => setOpen(false)}
              >
                {name}
              </Link>
            );
          })}
        </nav>
        <div className="nav-actions">
          <ThemeButton initial={theme} />
          <Link href={authenticated ? "/account" : "/join"} className="button primary nav-join">
            {authenticated ? "My profile" : "Join competition"}
            {!authenticated && <ArrowUpRight size={15} />}
          </Link>
          <button
            className="icon-button menu-toggle"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="primary-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}
