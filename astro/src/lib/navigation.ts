/** Browser-only navigation bridge for the unchanged search island. */
const router = {
  push(path: string) { window.location.assign(path); },
  replace(path: string) { window.location.replace(path); },
  refresh() { window.location.reload(); },
  back() { window.history.back(); },
  forward() { window.history.forward(); },
};
export function useRouter() { return router; }

/** Existing server view helpers signal a missing route through this bridge. */
export class PageNotFound extends Error {}
export function notFound(): never { throw new PageNotFound("Not found"); }
