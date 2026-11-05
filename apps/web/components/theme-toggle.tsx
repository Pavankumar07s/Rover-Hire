"use client";

import { useEffect, useId, useState } from "react";

type Theme = "light" | "dark";

const OPTIONS: { value: Theme; label: string; glyph: string }[] = [
  { value: "light", label: "Light", glyph: "☀︎" },
  { value: "dark", label: "Dark", glyph: "☽" },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // ignore storage errors (private mode, etc.)
  }
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  const name = useId();

  // Sync initial state from whatever the pre-hydration script already applied.
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  function select(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  return (
    <fieldset
      className={`inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5 ${className}`}
    >
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map((opt) => {
        const checked = theme === opt.value;
        return (
          <label
            key={opt.value}
            className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-150 ${
              checked
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={checked}
              onChange={() => select(opt.value)}
              className="sr-only"
            />
            <span aria-hidden="true">{opt.glyph}</span>
            <span className="hidden sm:inline">{opt.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
