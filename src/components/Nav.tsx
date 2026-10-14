"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TickerSearch } from "./TickerSearch";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/fund", label: "AI Fund" },
  { href: "/options", label: "Options Lab" },
  { href: "/compare", label: "Compare" },
  { href: "/advisor", label: "AI Advisor" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/settings", label: "Profile" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg pt-[env(safe-area-inset-top)] [view-transition-name:site-header]">
      <div className="mx-auto flex max-w-6xl items-center gap-x-4 gap-y-2 px-[max(1rem,env(safe-area-inset-left))] py-2.5 sm:flex-wrap sm:py-3 lg:flex-nowrap">
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
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
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
        </nav>
        <div className="ml-auto min-w-0 flex-1 sm:w-64 sm:flex-none lg:w-52">
          <TickerSearch />
        </div>
      </div>
    </header>
  );
}
