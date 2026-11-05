"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BaseMark } from "@/components/base-mark";
import { ArrowRight, ChevronDown, CloseIcon, MenuIcon } from "./icons";

type NavProps = {
  login: string;
  signup: string;
  docs: string;
  x402: string;
};

function navItems({ login, docs, x402 }: NavProps) {
  return [
    {
      label: "Product",
      items: [
        { label: "Proof", href: "#proof" },
        { label: "Control loop", href: "#loop" },
        { label: "MCU merchants", href: "#silicon" },
        { label: "Physical AI", href: "#product" },
        { label: "Console", href: login },
      ],
    },
    {
      label: "Developers",
      items: [
        { label: "Firmware SDK", href: `${docs}/docs/firmware` },
        { label: "Claude & ChatGPT", href: `${docs}/docs/agents` },
        { label: "x402 standard", href: x402 },
      ],
    },
    { label: "Docs", href: docs },
  ] as const;
}

function isMenu(
  item: ReturnType<typeof navItems>[number],
): item is Extract<ReturnType<typeof navItems>[number], { items: unknown }> {
  return "items" in item;
}

export function LandingNav(props: NavProps) {
  const NAV = navItems(props);
  const { login, signup } = props;
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (!navRef.current?.contains(target)) setFlyout(null);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 bg-[var(--canvas)]">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-6 px-5 md:px-8">
        <div className="flex min-w-0 items-center gap-7">
          <Link href="/" className="flex items-center gap-2.5">
            <BaseMark size={20} tone="on-dark" />
            <span className="text-[15px] tracking-tight text-white">0xBs</span>
          </Link>
          <nav
            ref={navRef}
            className="hidden items-center gap-1 text-[14px] text-[var(--body)] lg:flex"
          >
            {NAV.map((item) =>
              isMenu(item) ? (
                <div key={item.label} className="relative">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors hover:text-white"
                    aria-expanded={flyout === item.label}
                    onClick={() =>
                      setFlyout((v) => (v === item.label ? null : item.label))
                    }
                  >
                    {item.label}
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>
                  {flyout === item.label && (
                    <div className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-48 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[#111] py-1.5">
                      {item.items.map((link) => (
                        <a
                          key={link.label}
                          href={link.href}
                          className="block px-3.5 py-2 text-[13px] text-[var(--body)] hover:bg-white/5 hover:text-white"
                          onClick={() => setFlyout(null)}
                        >
                          {link.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <a
                  key={item.label}
                  href={item.href}
                  className="rounded-md px-2 py-1.5 transition-colors hover:text-white"
                >
                  {item.label}
                </a>
              ),
            )}
          </nav>
        </div>

        <div className="hidden items-center gap-2.5 lg:flex">
          <a href={login} className="landing-pill">
            Log in
          </a>
          <a href={signup} className="landing-pill-fill">
            Get started
            <ArrowRight />
          </a>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--hairline-strong)] text-white lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--hairline)] bg-[var(--canvas)] px-5 py-6 lg:hidden">
          <nav className="flex flex-col gap-1 text-[16px]">
            {NAV.map((item) =>
              isMenu(item) ? (
                <div key={item.label} className="py-1">
                  <div className="px-2 py-2 text-[13px] text-[var(--body-mid)]">
                    {item.label}
                  </div>
                  {item.items.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      className="block rounded-lg px-2 py-2.5 text-[var(--body)] hover:text-white"
                      onClick={() => setOpen(false)}
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : (
                <a
                  key={item.label}
                  href={item.href}
                  className="rounded-lg px-2 py-3 text-[var(--body)] hover:text-white"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ),
            )}
          </nav>
          <div className="mt-5 flex flex-col gap-2">
            <a href={login} className="landing-pill w-full" onClick={() => setOpen(false)}>
              Log in
            </a>
            <a
              href={signup}
              className="landing-pill-fill w-full"
              onClick={() => setOpen(false)}
            >
              Get started
              <ArrowRight />
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
