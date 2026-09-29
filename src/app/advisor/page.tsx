"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Chat } from "@/components/Chat";

export default function AdvisorPage() {
  return (
    <div className="h-[calc(100dvh-11rem)] min-h-[420px]">
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
