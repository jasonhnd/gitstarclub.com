import type { APIRoute } from "astro";
import { rankingImage } from "../../../../packages/p1/og";
export const prerender = false;
export const GET: APIRoute = ({ params, locals }) => rankingImage(locals.data, params.year ?? "", params.period ?? "");
