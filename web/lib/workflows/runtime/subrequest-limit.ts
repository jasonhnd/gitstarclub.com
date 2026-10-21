/** Cloudflare has used both messages for exhausted internal/HTTP subrequests. */
export function isSubrequestLimitError(error: unknown): boolean {
  return error instanceof Error && /Too many (?:API requests by single Worker invocation|subrequests)/i.test(error.message);
}
