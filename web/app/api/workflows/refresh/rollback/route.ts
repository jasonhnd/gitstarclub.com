import { createHash } from "node:crypto";
import { z } from "zod";
import { SafeText } from "@/lib/contracts";
import { requireBearerToken } from "@/lib/security";
import { requireBlobBaseUrl, requireBlobWriteToken } from "@/lib/runtime-config";
import { claimWorkflowLease, releaseWorkflowLease } from "@/lib/workflows/lease";
import { rollbackVersion } from "@/lib/workflows/rollback";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RollbackRequest = z.object({ target_version: SafeText }).strict();

/** Authenticated, fenced rollback entrypoint. An idempotency-key header is mandatory. */
export async function POST(req: Request): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;

  const idempotencyKey = req.headers.get("idempotency-key") ?? req.headers.get("x-idempotency-key");
  if (!idempotencyKey) return Response.json({ ok: false, error: "idempotency-key header is required" }, { status: 400 });

  let targetVersion: string;
  try {
    targetVersion = RollbackRequest.parse(await req.json()).target_version;
    requireBlobBaseUrl();
    requireBlobWriteToken();
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof z.ZodError ? "invalid rollback request" : "invalid runtime config" }, { status: 400 });
  }

  const digest = createHash("sha256").update(`${idempotencyKey}\0${targetVersion}`).digest("hex").slice(0, 20);
  const operationId = `rollback-${digest}`;
  const acquiredAt = new Date().toISOString();
  const claim = await claimWorkflowLease({
    runId: operationId,
    acquiredAt,
    idempotencyKey: operationId,
    trigger: "rollback-api",
  });
  if (claim.status !== "acquired" || claim.lease.run_id !== operationId) {
    return Response.json(
      { ok: false, operationId: claim.lease.run_id, status: claim.status, activeUntil: claim.lease.expires_at },
      { status: 409 },
    );
  }

  try {
    const result = await rollbackVersion(operationId, claim.lease.fencing_token, targetVersion);
    const released = await releaseWorkflowLease(
      operationId,
      "published",
      undefined,
      new Date().toISOString(),
      claim.lease.fencing_token,
    );
    if (!released) throw new Error(`failed to release rollback fencing token ${claim.lease.fencing_token}`);
    return Response.json({ ok: true, operationId, ...result });
  } catch (error) {
    const released = await releaseWorkflowLease(
      operationId,
      "failed",
      undefined,
      new Date().toISOString(),
      claim.lease.fencing_token,
    );
    console.error("[workflow-rollback] failed", {
      operation_id: operationId,
      target_version: targetVersion,
      released,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ ok: false, operationId, error: "Rollback failed" }, { status: 500 });
  }
}
