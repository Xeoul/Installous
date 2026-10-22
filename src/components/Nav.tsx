"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MarketClock } from "./MarketClock";
import { MORE } from "./TabBar";
import { TickerSearch } from "./TickerSearch";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/fund", label: "AI Fund" },
  { href: "/options", label: "Options Lab" },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg pt-[env(safe-area-inset-top)] [view-transition-name:site-header]">
      <div className="mx-auto flex max-w-[1920px] items-center gap-x-4 gap-y-2 px-[max(1rem,env(safe-area-inset-left))] lg:px-8 min-[1600px]:px-12 py-2.5 sm:flex-wrap sm:py-3 lg:flex-nowrap">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-semibold">
          <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden>
            <rect width="64" height="64" rx="14" fill="var(--accent)" />
            <path d="M20 46 L31 33 L37 39 L46 24" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="46" cy="24" r="4" fill="#fff" />
          </svg>
          <span className="hidden min-[400px]:inline">Installous</span>
        </Link>
        {/* Phones use the bottom tab bar instead. */}
        <nav className="hidden gap-1 sm:flex" aria-label="Sections">
          {LINKS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                  active ? "bg-surface-2 font-medium text-text" : "text-text-2 hover:text-text"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <MoreMenu pathname={pathname} />
        </nav>
        <div className="ml-auto">
          <MarketClock />
        </div>
        <div className="min-w-0 flex-1 sm:w-64 sm:flex-none lg:w-auto lg:max-w-52 lg:flex-1">
          <TickerSearch />
        </div>
      </div>
    </header>
  );
}

/** The less-used pages, behind a small "More" menu on wider screens. */
function MoreMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = MORE.some((m) => isActive(pathname, m.href));

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
          active ? "bg-surface-2 font-medium text-text" : "text-text-2 hover:text-text"
        }`}
      >
        More
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul role="menu" className="absolute left-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
          {MORE.map((m) => (
            <li key={m.href} role="none">
              <Link
                role="menuitem"
                href={m.href}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2 text-sm hover:bg-surface-2 ${isActive(pathname, m.href) ? "font-medium text-accent" : "text-text"}`}
              >
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
