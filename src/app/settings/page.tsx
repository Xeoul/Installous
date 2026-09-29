"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { getProfile, saveProfile } from "@/lib/client-data";
import type { InvestorProfile as Profile } from "@/lib/store";

const RISKS: { value: Profile["risk"]; label: string; desc: string }[] = [
  { value: "conservative", label: "Conservative", desc: "Preserve capital; prefer stable, dividend-paying companies." },
  { value: "moderate", label: "Moderate", desc: "Balance growth and stability; accept normal market swings." },
  { value: "aggressive", label: "Aggressive", desc: "Maximize growth; comfortable with large drawdowns." },
];

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getProfile().then(setProfile);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    try {
      await saveProfile(profile);
      setStatus("Saved. Installous will use this in its next answer.");
    } catch {
      setStatus("Couldn't save your profile.");
    }
  }

  if (!profile) return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Investor profile</h1>
        <p className="text-text-2">Installous tailors its picks, position sizing, and risk commentary to this profile.</p>
      </div>
      <Card>
        <form onSubmit={save} className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Risk tolerance</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {RISKS.map((r) => (
                <label
                  key={r.value}
                  className={`cursor-pointer rounded-xl border p-3 text-sm ${profile.risk === r.value ? "border-accent bg-accent/10" : "border-border"}`}
                >
                  <input type="radio" name="risk" value={r.value} checked={profile.risk === r.value} onChange={() => setProfile({ ...profile, risk: r.value })} className="sr-only" />
                  <div className="font-medium">{r.label}</div>
                  <div className="mt-1 text-xs text-text-2">{r.desc}</div>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-medium">
            Time horizon
            <input value={profile.horizon} onChange={(e) => setProfile({ ...profile, horizon: e.target.value })} className="input mt-1 w-full" placeholder="e.g. 10+ years, retirement in 2045" />
          </label>
          <label className="block text-sm font-medium">
            Goals &amp; preferences
            <textarea
              value={profile.goals}
              onChange={(e) => setProfile({ ...profile, goals: e.target.value })}
              rows={4}
              className="input mt-1 w-full"
              placeholder="e.g. Grow my savings, prefer tech and healthcare, avoid tobacco, keep ~20% in dividend stocks"
            />
          </label>
          <div className="flex items-center gap-3">
            <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">Save profile</button>
            {status && <span className="text-sm text-text-2">{status}</span>}
          </div>
        </form>
      </Card>
    </div>
  );
}
