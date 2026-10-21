import type { APIRoute } from "astro";
import { start } from "../../../../packages/p7/operations";
import { optionsFor, unsupportedMethod } from "../../../../packages/p7/methods";

export const GET: APIRoute = (context) => start(context);

export const HEAD = GET;
export const OPTIONS = optionsFor("GET");
export const ALL = unsupportedMethod;
