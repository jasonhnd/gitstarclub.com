import { type Locale } from "@/lib/i18n";
import type { NarrativeTexts } from "@/lib/narrative";

export function Narrative({ texts, locale = "en" }: { texts: NarrativeTexts; locale?: Locale }) {
  return (
    <div className="max-w-[64ch] text-[clamp(1.05rem,1.8vw,1.3rem)] leading-relaxed text-on-surface">
      <p lang={locale}>{texts[locale]}</p>
    </div>
  );
}
