import type { APIRoute } from "astro";
import { runLiveRefreshRoute } from "../../../packages/p7/operations";

export const GET: APIRoute = ({ request }) => runLiveRefreshRoute(request, "daily");
