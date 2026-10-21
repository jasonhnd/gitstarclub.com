import type { AnchorHTMLAttributes } from "react";

/** Existing search island links use normal document navigation on Astro. */
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
