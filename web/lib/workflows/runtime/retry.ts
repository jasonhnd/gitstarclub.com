import { WorkflowLeaseOwnershipError } from "@/lib/workflows/lease";

export type RetryPolicy = {
  retries: number;
  delaysMs: readonly number[];
};

export const DEFAULT_STEP_RETRY: RetryPolicy = {
  retries: 2,
  delaysMs: [250, 1000],
};

export function isRetryableStepError(error: unknown): boolean {
  return !(error instanceof WorkflowLeaseOwnershipError);
}

export async function withStepRetry<T>(
  name: string,
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_STEP_RETRY,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  retryable: (error: unknown) => boolean = isRetryableStepError,
): Promise<T> {
  let lastError: unknown;
  const attempts = policy.retries + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt >= policy.retries) break;
      const delay = policy.delaysMs[attempt] ?? policy.delaysMs.at(-1) ?? 0;
      if (delay > 0) await sleep(delay);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw lastError instanceof Error ? lastError : new Error(`${name} failed: ${message}`);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
