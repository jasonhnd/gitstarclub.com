import type { APIRoute } from "astro";
import { languageRedirect } from "../../lib/routing";

export const GET: APIRoute = ({ request }) => languageRedirect(request);
