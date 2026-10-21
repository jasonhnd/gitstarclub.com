import type { APIRoute } from "astro";
import { step } from "../../../../packages/p7/operations";
import { optionsFor, unsupportedMethod } from "../../../../packages/p7/methods";

export const POST: APIRoute = (context) => step(context);

export const OPTIONS = optionsFor("POST");
export const ALL = unsupportedMethod;
