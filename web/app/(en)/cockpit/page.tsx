import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { CockpitClient } from "./CockpitClient";
import { COCKPIT_PATH } from "@/lib/cockpit/posed-frames";
import { COPY } from "@/lib/cockpit/copy";
import { getDictionary } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-static";
export const revalidate = false;

export function generateMetadata(): Metadata {
  return {
    ...pageMeta({
      title: COPY.title,
      description: COPY.lede,
      path: COCKPIT_PATH,
      locale: "en",
      participatesInLocalizedSeo: false,
    }),
    robots: { index: false, follow: false },
  };
}

export default async function CockpitPage() {
  const dictionary = await getDictionary("en");
  return (
    <>
      <Chrome locale="en" canonicalPath={COCKPIT_PATH} dictionary={dictionary} tag={COPY.title} />
      <main id="main" tabIndex={-1}>
        <CockpitClient />
      </main>
    </>
  );
}
