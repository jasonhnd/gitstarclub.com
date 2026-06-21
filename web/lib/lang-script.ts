import { LANG_COOKIE, LOCALES } from "@/lib/i18n";

const localesJson = JSON.stringify(LOCALES);

export const LANG_INIT_SCRIPT = `!function(){try{var match=document.cookie.match(/(?:^|; )${LANG_COOKIE}=([^;]*)/);var locale=match?decodeURIComponent(match[1]):"";if(${localesJson}.indexOf(locale)!==-1){document.documentElement.lang=locale;}}catch(e){}}();`;
