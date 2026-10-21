import type { APIRoute } from "astro";
import { rankingImage } from "../../../packages/p1/og";
export const prerender = false;
export const GET: APIRoute = ({ params }) => rankingImage(params.year ?? "");
