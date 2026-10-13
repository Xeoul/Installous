"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Advisor answers: GitHub-flavored markdown (tables, lists, links). */
export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
