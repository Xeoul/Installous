"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Phone navigation, iOS style: a tab bar along the bottom (inside the home
// indicator's safe area) for the main sections, and a "More" sheet for the rest.
// Hidden from the small breakpoint up, where the header shows every link.

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

const TABS = [
  { href: "/", label: "Home", icon: icon(<path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" />) },
  { href: "/fund", label: "AI Fund", icon: icon(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5V12l6 6" /></>) },
  { href: "/options", label: "Options", icon: icon(<path d="M3 17l5-6 4 4 4-7 5 9" />) },
];

const MORE = [
  { href: "/compare", label: "Compare stocks" },
  { href: "/advisor", label: "AI Advisor" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/settings", label: "Investor profile" },
  { href: "/picks", label: "Top picks" },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function TabBar() {
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);
  const close = useCallback(() => setSheet(false), []);
  const moreActive = MORE.some((m) => isActive(pathname, m.href));

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl [view-transition-name:tab-bar] sm:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={isActive(pathname, t.href) ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium ${
                isActive(pathname, t.href) ? "text-accent" : "text-muted"
              }`}
            >
              {t.icon}
              {t.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-haspopup="dialog"
            aria-expanded={sheet}
            className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium ${moreActive ? "text-accent" : "text-muted"}`}
          >
            {icon(
              <>
                <circle cx="5.5" cy="12" r="1.4" />
                <circle cx="12" cy="12" r="1.4" />
                <circle cx="18.5" cy="12" r="1.4" />
              </>,
            )}
            More
          </button>
        </div>
      </nav>
      {sheet && <MoreSheet pathname={pathname} onClose={close} />}
    </>
  );
}

function MoreSheet({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const opened = useRef(pathname);

  // Close on Escape, and when a link in the sheet navigates somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (pathname !== opened.current) onClose();
  }, [pathname, onClose]);

  return (
    <div className="fixed inset-0 z-40 sm:hidden" role="dialog" aria-modal="true" aria-label="More">
      <button type="button" aria-label="Close" onClick={onClose} className="sheet-backdrop absolute inset-0 bg-black/40" />
      <div
        ref={panelRef}
        className="sheet-panel absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2"
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" aria-hidden />
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface-2">
          {MORE.map((m) => (
            <li key={m.href}>
              <Link
                href={m.href}
                onClick={onClose}
                className={`flex items-center justify-between px-4 py-3.5 text-[15px] ${isActive(pathname, m.href) ? "text-accent" : ""}`}
              >
                {m.label}
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl bg-surface-2 py-3 text-[15px] font-medium text-accent">
          Done
        </button>
      </div>
    </div>
  );
}
