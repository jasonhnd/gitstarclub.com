import type { APIRoute } from "astro";
import { rollback } from "../../../../packages/p7/operations";
import { optionsFor, unsupportedMethod } from "../../../../packages/p7/methods";

export const POST: APIRoute = ({ request }) => rollback(request);

export const OPTIONS = optionsFor("POST");
export const ALL = unsupportedMethod;
