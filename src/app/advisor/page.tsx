"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Chat } from "@/components/Chat";

export default function AdvisorPage() {
  // Fills the screen down to the chat box: on phones, above the tab bar and home indicator.
  return (
    <div className="h-[calc(100dvh-12.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[380px] sm:h-[calc(100dvh-11rem)]">
      <Suspense>
        <AdvisorChat />
      </Suspense>
    </div>
  );
}

function AdvisorChat() {
  const q = useSearchParams().get("q") ?? undefined;
  return <Chat initialPrompt={q} />;
}
