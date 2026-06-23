import { runLiveRefreshRoute } from "@/lib/cron/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(req: Request) {
  return runLiveRefreshRoute(req, "weekly");
}
