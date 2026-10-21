import { useMemo, useSyncExternalStore } from "react";

const event = "gsc:compare-url";
function subscribe(update: () => void) {
  window.addEventListener(event, update);
  window.addEventListener("popstate", update);
  return () => { window.removeEventListener(event, update); window.removeEventListener("popstate", update); };
}
const router = {
  replace(url: string, _options?: { scroll?: boolean }) {
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(event));
  },
};

/** Preserve URL-only selection without navigation, reload or scroll changes. */
export function useCompareNavigation(initialSearch: string) {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => initialSearch);
  return { router, params: useMemo(() => new URLSearchParams(search), [search]) };
}
