import { Chat } from "@/components/Chat";

export default async function AdvisorPage({ searchParams }: PageProps<"/advisor">) {
  const { q } = await searchParams;
  const prompt = typeof q === "string" ? q : undefined;
  return (
    <div className="h-[calc(100dvh-11rem)] min-h-[420px]">
      <Chat initialPrompt={prompt} />
    </div>
  );
}
