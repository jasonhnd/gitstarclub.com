import Link from "next/link";
import { Chrome } from "@/app/_explore/Chrome";
import { PageShell } from "@/app/_explore/PageShell";
import type { Dict, Locale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routing";

type NotFoundCopy = {
  eyebrow: string;
  title: string;
  description: string;
  home: string;
};

export const NOT_FOUND_COPY: Record<Locale, NotFoundCopy> = {
  en: {
    eyebrow: "Error 404",
    title: "Page not found",
    description: "The page may have moved, or the address may be incorrect. Return home to keep exploring open source history.",
    home: "Return home",
  },
  ja: {
    eyebrow: "エラー 404",
    title: "ページが見つかりません",
    description: "ページが移動したか、アドレスが正しくない可能性があります。ホームに戻ってオープンソースの履歴をご覧ください。",
    home: "ホームに戻る",
  },
  zh: {
    eyebrow: "错误 404",
    title: "找不到页面",
    description: "页面可能已移动，或地址不正确。返回首页，继续浏览开源项目历史。",
    home: "返回首页",
  },
  "zh-TW": {
    eyebrow: "錯誤 404",
    title: "找不到頁面",
    description: "頁面可能已移動，或網址不正確。返回首頁，繼續瀏覽開源專案歷史。",
    home: "返回首頁",
  },
  ko: {
    eyebrow: "오류 404",
    title: "페이지를 찾을 수 없습니다",
    description: "페이지가 이동했거나 주소가 올바르지 않을 수 있습니다. 홈으로 돌아가 오픈 소스 기록을 계속 살펴보세요.",
    home: "홈으로 돌아가기",
  },
  es: {
    eyebrow: "Error 404",
    title: "Página no encontrada",
    description: "Es posible que la página se haya movido o que la dirección sea incorrecta. Vuelve al inicio para seguir explorando la historia del código abierto.",
    home: "Volver al inicio",
  },
  fr: {
    eyebrow: "Erreur 404",
    title: "Page introuvable",
    description: "La page a peut-être été déplacée ou l’adresse est incorrecte. Revenez à l’accueil pour poursuivre votre exploration de l’histoire de l’open source.",
    home: "Revenir à l’accueil",
  },
};

export function LocalizedNotFound({ locale, dictionary }: { locale: Locale; dictionary: Dict }) {
  const copy = NOT_FOUND_COPY[locale];
  const home = localizedPath(locale, "/");

  return (
    <>
      <Chrome tag="404" locale={locale} canonicalPath="/" dictionary={dictionary} />
      <PageShell width="narrow" className="flex flex-1 items-center">
        <section aria-labelledby="not-found-title" className="w-full rounded-[2rem] border border-outline-variant bg-surface-container px-6 py-12 shadow-[var(--elev-1)] sm:px-10 sm:py-16">
          <p className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-tertiary">
            {copy.eyebrow}
          </p>
          <h1 id="not-found-title" className="mt-3 max-w-[18ch] text-balance text-[clamp(2.25rem,7vw,4.75rem)] font-extrabold leading-[0.98] tracking-[-0.055em] text-on-surface">
            {copy.title}
          </h1>
          <p className="mt-6 max-w-[58ch] text-pretty leading-7 text-on-surface-variant">
            {copy.description}
          </p>
          <Link
            href={home}
            className="mt-8 inline-flex min-h-11 items-center rounded-full bg-primary-container px-5 py-2 font-mono text-[0.82rem] font-semibold text-on-primary-container transition-[background-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--elev-1)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            {copy.home}
          </Link>
        </section>
      </PageShell>
    </>
  );
}
