import type { Metadata, Viewport } from "next";
import { ViewTransition } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { DemoBanner } from "@/components/DemoBanner";
import { Nav } from "@/components/Nav";
import { TabBar } from "@/components/TabBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Installous — Personal AI Investor",
  description: "Research stocks, rank ideas, and get AI-powered investment analysis.",
  // "default" rather than "black-translucent": iOS colours the status bar from
  // themeColor below and picks dark or light text to match, so the clock stays
  // readable in light mode instead of always being white.
  appleWebApp: { capable: true, title: "Installous", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Draw under the notch and home indicator; the header and tab bar pad for them.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* The header comes first, padded for the status bar wherever a browser draws the page under it. */}
        <Nav />
        <DemoBanner />
        <main className="mx-auto w-full max-w-6xl flex-1 px-[max(1rem,env(safe-area-inset-left))] py-5 sm:py-6">
          {/* Navigations are transitions, so the page crossfades instead of swapping (see globals.css). */}
          <ViewTransition name="page">{children}</ViewTransition>
        </main>
        {/* On phones, leave room for the tab bar and the home indicator. */}
        <footer className="mx-auto w-full max-w-6xl px-[max(1rem,env(safe-area-inset-left))] pb-[calc(5rem+env(safe-area-inset-bottom))] text-xs text-muted sm:pb-6">
          Market data from Yahoo Finance, may be delayed. Scores and AI analysis are research tools, not financial
          advice.
        </footer>
        <TabBar />
      </body>
    </html>
  );
}
