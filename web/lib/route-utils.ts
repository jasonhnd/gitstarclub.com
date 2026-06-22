export function parsePositiveIntegerParam(value: string | null): number | null {
  if (value === null) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function safeInternalRedirectPath(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
