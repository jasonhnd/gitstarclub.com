import { assertPreviewTargetAllowed, getPreviewTarget, type PreviewTarget } from "@/lib/runtime-config";

export type ResolvePreviewTargetOptions = {
  env?: Record<string, string | undefined>;
  target?: PreviewTarget;
};

export function resolvePreviewTarget(opts: ResolvePreviewTargetOptions = {}): PreviewTarget {
  const env = opts.env ?? process.env;
  assertPreviewTargetAllowed(env);
  const target = opts.target ?? getPreviewTarget(env);
  switch (target) {
    case "vercel":
    case "cf":
      return target;
    default: {
      const _exhaustive: never = target;
      throw new Error(`unsupported PREVIEW_TARGET: ${String(_exhaustive)}`);
    }
  }
}

export function describePreviewTarget(opts: ResolvePreviewTargetOptions = {}): { target: PreviewTarget } {
  return { target: opts.target ?? getPreviewTarget(opts.env) };
}
