import { notFound } from "next/navigation";
import { LOCALES, parseLang } from "@/lib/i18n";

// Nested under the root layout (which owns <html>). Validates the locale and scopes the
// language on a display:contents wrapper so screen readers get the right lang per subtree
// without a second <html>. Prebuilds the three locales.
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export default async function LangLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ lang: string }> }>) {
  const loc = parseLang((await params).lang);
  if (!loc) notFound();
  return (
    <div lang={loc} className="contents">
      {children}
    </div>
  );
}
