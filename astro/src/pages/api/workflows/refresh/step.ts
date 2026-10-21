import type { APIRoute } from "astro";
import { step } from "../../../../packages/p7/operations";

export const POST: APIRoute = (context) => step(context);
