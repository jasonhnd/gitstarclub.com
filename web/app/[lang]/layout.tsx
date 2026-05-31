import { notFound } from "next/navigation";
import { LOCALES, parseLang, getDictionary } from "@/lib/i18n";
import { getMeta } from "@/lib/data";
import { Footer } from "@/app/_explore/Footer";

// Nested under the root layout (which owns <html>). Validates the locale, scopes the
// language on a display:contents wrapper, and appends the shared Footer to every page.
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export default async function LangLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ lang: string }> }>) {
  const loc = parseLang((await params).lang);
  if (!loc) notFound();
  const [t, meta] = await Promise.all([getDictionary(loc), getMeta()]);
  return (
    <div lang={loc} className="contents">
      {children}
      <Footer locale={loc} t={t} asOf={meta?.seam_date} />
    </div>
  );
}
