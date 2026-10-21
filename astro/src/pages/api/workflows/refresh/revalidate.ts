import type { APIRoute } from "astro";
import { revalidate } from "../../../../packages/p7/operations";

export const POST: APIRoute = (context) => revalidate(context);
