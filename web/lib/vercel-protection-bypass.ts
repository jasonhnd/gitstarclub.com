/** Headers that let CI/automation through Vercel Authentication on Preview. */
export function vercelProtectionBypassHeaders(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const token = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!token) return {};
  return {
    "x-vercel-protection-bypass": token,
    "x-vercel-set-bypass-cookie": "true",
  };
}
