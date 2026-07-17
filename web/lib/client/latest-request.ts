export type LatestRequest = {
  id: number;
  signal: AbortSignal;
};

/**
 * Owns one freshness-sensitive browser request at a time. Starting a newer
 * request aborts its predecessor, while the monotonically increasing id lets
 * callers discard a response even when a mocked or non-compliant fetch ignores
 * AbortSignal.
 */
export class LatestRequestController {
  private controller: AbortController | null = null;
  private sequence = 0;

  begin(): LatestRequest {
    this.controller?.abort();
    this.controller = new AbortController();
    return { id: ++this.sequence, signal: this.controller.signal };
  }

  isCurrent(id: number): boolean {
    return id === this.sequence;
  }

  finish(id: number): void {
    if (id === this.sequence) this.controller = null;
  }

  cancel(id?: number): void {
    if (id !== undefined && id !== this.sequence) return;
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}
