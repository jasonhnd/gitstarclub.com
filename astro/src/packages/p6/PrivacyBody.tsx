import { PAD_X } from "@/app/_explore/layout-tokens";
import { type Dict } from "@/lib/i18n";

export function PrivacyBody({ dictionary: t }: { dictionary: Dict }) {
  return (
    <>
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[60rem] py-[clamp(2rem,5vw,4rem)] ${PAD_X}`}>
        <p className="font-mono text-[0.8rem] uppercase tracking-wider text-on-surface-variant">{t.privacy.eyebrow}</p>
        <h1 className="mt-3 max-w-[16ch] text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-[1.04] text-on-surface">
          {t.privacy.title}
        </h1>
        <div className="mt-8 flex max-w-[62ch] flex-col gap-6 text-[1.02rem] leading-relaxed text-on-surface-variant">
          <section>
            <h2 className="mb-2 text-[1.2rem] font-extrabold text-on-surface">{t.privacy.analyticsTitle}</h2>
            <p>{t.privacy.analyticsBody}</p>
          </section>
          <section>
            <h2 className="mb-2 text-[1.2rem] font-extrabold text-on-surface">{t.privacy.cookiesTitle}</h2>
            <p>{t.privacy.cookiesBody}</p>
          </section>
          <section>
            <h2 className="mb-2 text-[1.2rem] font-extrabold text-on-surface">{t.privacy.dataTitle}</h2>
            <p>{t.privacy.dataBody}</p>
          </section>
        </div>
      </main>
    </>
  );
}
