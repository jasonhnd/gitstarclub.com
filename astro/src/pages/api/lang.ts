import type { APIRoute } from "astro";
import { languageRedirect } from "../../lib/routing";
import { optionsFor, unsupportedMethod } from "../../packages/p7/methods";

export const GET: APIRoute = ({ request }) => languageRedirect(request);

export const HEAD = GET;
export const OPTIONS = optionsFor("GET");
export const ALL = unsupportedMethod;
