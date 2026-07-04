"use client";

import { useState } from "react";

// Share control: copy the page link (transient "Copied" feedback) + open an X (Twitter) intent.
// Client-only; reads window.location at click time. Labels use default chrome text. (v0.2 §4)
export type ShareButtonLabels = {
  label: string;
  copied: string;
  onX: string;
  opensNewTab: string;
};

const DEFAULT_LABELS: ShareButtonLabels = {
  label: "Share",
  copied: "Copied",
  onX: "Share on X",
  opensNewTab: "opens in new tab",
};

export function ShareButton({ text, labels = DEFAULT_LABELS }: { text?: string; labels?: ShareButtonLabels }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      // clipboard blocked (insecure context / permissions) — no-op, the X share still works
    }
  };

  const shareX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text ?? "")}&url=${encodeURIComponent(window.location.href)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 font-mono text-[0.78rem] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {done ? labels.copied : labels.label}
      </button>
      <button
        type="button"
        onClick={shareX}
        aria-label={`${labels.onX} (${labels.opensNewTab})`}
        title={`${labels.onX} (${labels.opensNewTab})`}
        className="inline-flex size-11 items-center justify-center rounded-full border border-outline-variant bg-surface-container text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </button>
    </div>
  );
}
