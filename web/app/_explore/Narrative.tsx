import { type Locale } from "@/lib/i18n";
import type { NarrativeText } from "@/lib/narrative";

export function Narrative({ text, locale = "en" }: { text: NarrativeText; locale?: Locale }) {
  return (
    <div className="max-w-[64ch] text-[clamp(1.05rem,1.8vw,1.3rem)] leading-relaxed text-on-surface">
      <p lang={locale}>{text}</p>
    </div>
  );
}
