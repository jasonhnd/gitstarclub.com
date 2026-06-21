import { NextResponse } from "next/server";
import { DEFAULT_LOCALE, LANG_COOKIE, isLocale } from "@/lib/i18n";
import { safeInternalRedirectPath } from "@/lib/route-utils";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function GET(req: Request) {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang");
  const locale = lang && isLocale(lang) ? lang : DEFAULT_LOCALE;
  const safeNext = safeInternalRedirectPath(url.searchParams.get("next"));
  const res = NextResponse.redirect(new URL(safeNext, url));
  res.cookies.set(LANG_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}
