"use client";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";

export function ThemeButton({ initial }: { initial: string }) {
  const [theme, setTheme] = useState(initial);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
  }
  return (
    <button
      onClick={toggle}
      className="icon-button"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
