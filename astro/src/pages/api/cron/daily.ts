import type { APIRoute } from "astro";
import { runLiveRefreshRoute } from "../../../packages/p7/operations";
import { optionsFor, unsupportedMethod } from "../../../packages/p7/methods";

export const GET: APIRoute = ({ request }) => runLiveRefreshRoute(request, "daily");

export const HEAD = GET;
export const OPTIONS = optionsFor("GET");
export const ALL = unsupportedMethod;
