import { LOCALES } from "@/lib/i18n";
import type { NarrativeTexts } from "@/lib/narrative";

export function Narrative({ texts }: { texts: NarrativeTexts }) {
  return (
    <div className="i18n-narrative max-w-[64ch] text-[clamp(1.05rem,1.8vw,1.3rem)] leading-relaxed text-on-surface">
      {LOCALES.map((locale) => (
        <p key={locale} lang={locale} data-locale={locale}>
          {texts[locale]}
        </p>
      ))}
    </div>
  );
}
