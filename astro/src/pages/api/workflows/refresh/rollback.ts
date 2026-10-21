import type { APIRoute } from "astro";
import { rollback } from "../../../../packages/p7/operations";

export const POST: APIRoute = ({ request }) => rollback(request);
