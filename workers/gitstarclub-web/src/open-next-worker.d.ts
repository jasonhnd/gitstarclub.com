declare module "../../../web/.open-next/worker.js" {
  const worker: {
    fetch(
      request: Request,
      env: unknown,
      ctx: { waitUntil(promise: Promise<unknown>): void },
    ): Promise<Response> | Response;
  };
  export default worker;
}
