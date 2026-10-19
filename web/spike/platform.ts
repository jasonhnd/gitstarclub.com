import { proofContext } from "./context";

// Bridge only for this throwaway proof. The migration must replace old imports.
export function getCloudflareContext() {
  const context = proofContext.getStore();
  if (!context) throw new Error("No local Worker context");
  return { env: context.env };
}
