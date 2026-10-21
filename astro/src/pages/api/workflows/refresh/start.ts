import type { APIRoute } from "astro";
import { start } from "../../../../packages/p7/operations";

export const GET: APIRoute = (context) => start(context);
