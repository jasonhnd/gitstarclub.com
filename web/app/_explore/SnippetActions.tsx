"use client";

import { useState } from "react";

export function SnippetActions({
  copyText,
  embedHtml,
  labels = { copy: "Copy", copied: "Copied", embed: "Embed", embedCopied: "Embed copied" },
}: {
  copyText: string;
  embedHtml: string;
  labels?: { copy: string; copied: string; embed: string; embedCopied: string };
}) {
  const [copied, setCopied] = useState<"text" | "embed" | null>(null);

  async function copy(value: string, kind: "text" | "embed") {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard permissions can fail in previews or non-secure contexts.
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => copy(copyText, "text")}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="9" y="9" width="10" height="10" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {copied === "text" ? labels.copied : labels.copy}
      </button>
      <button
        type="button"
        onClick={() => copy(embedHtml, "embed")}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </svg>
        {copied === "embed" ? labels.embedCopied : labels.embed}
      </button>
    </div>
  );
}
