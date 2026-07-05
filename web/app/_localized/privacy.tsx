import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getDictionary, type Locale } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

const PRIVACY_PATH = "/privacy";

export async function generatePrivacyMetadata(locale: Locale): Promise<Metadata> {
  const t = await getDictionary(locale);
  return pageMeta({
    title: t.meta.privacyTitle,
    description: t.meta.privacyDescription,
    path: PRIVACY_PATH,
    locale,
  });
}

export async function PrivacyPageView({ locale }: { locale: Locale }) {
  const t = await getDictionary(locale);
  return (
    <>
      <Chrome locale={locale} canonicalPath={PRIVACY_PATH} dictionary={t} />
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
