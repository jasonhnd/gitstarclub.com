import type { Locale } from "@/lib/i18n";
import type { CoreSeoCopy, DetailText } from "./types";
import { detail as enDetail, seo as enSeo } from "./en";
import { detail as jaDetail, seo as jaSeo } from "./ja";
import { detail as zhDetail, seo as zhSeo } from "./zh";
import { detail as zhTWDetail, seo as zhTWSeo } from "./zh-TW";
import { detail as koDetail, seo as koSeo } from "./ko";
import { detail as esDetail, seo as esSeo } from "./es";
import { detail as frDetail, seo as frSeo } from "./fr";

export const DETAIL_TEXT: Record<Locale, DetailText> = {
  "en": enDetail,
  "ja": jaDetail,
  "zh": zhDetail,
  "zh-TW": zhTWDetail,
  "ko": koDetail,
  "es": esDetail,
  "fr": frDetail,
};

export const SEO_TEXT: Record<Locale, CoreSeoCopy> = {
  "en": enSeo,
  "ja": jaSeo,
  "zh": zhSeo,
  "zh-TW": zhTWSeo,
  "ko": koSeo,
  "es": esSeo,
  "fr": frSeo,
};
