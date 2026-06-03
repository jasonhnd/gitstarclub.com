"use client";

import { useDict } from "@/lib/i18n/client";

// Auto-generated monthly chronicle blurb (v0.2 §2). The data is bilingual (en/zh); like the
// chrome it renders the default locale (English) on the server and swaps to Chinese after
// hydration when the cookie locale is zh / zh-TW. First client render matches the SSR markup.
export function Narrative({ en, zh }: { en: string; zh: string }) {
  const { locale } = useDict();
  const text = locale === "zh" || locale === "zh-TW" ? zh : en;
  return <p className="max-w-[64ch] text-[clamp(1.05rem,1.8vw,1.3rem)] leading-relaxed text-on-surface">{text}</p>;
}
