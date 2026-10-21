import { createElement } from "react";
import { ShareButton as ExistingShareButton } from "@/app/_explore/ShareButton";
import { ShareableSnippet as ExistingSnippet } from "@/app/_explore/ShareableSnippet";
export type { ShareableSnippetLabels } from "@/app/_explore/ShareableSnippet";

/** Preserve the existing server markup; only these controls receive browser behavior. */
export function ShareButton(props: Parameters<typeof ExistingShareButton>[0]) {
  return createElement("gsc-repo-share", { style: { display: "contents" }, "data-controls": JSON.stringify({ kind: "share", ...props }) }, <ExistingShareButton {...props} />);
}
export function ShareableSnippet(props: Parameters<typeof ExistingSnippet>[0]) {
  return createElement("gsc-repo-share", { style: { display: "contents" }, "data-controls": JSON.stringify({ kind: "snippet", snippet: props.snippet, labels: props.labels }) }, <ExistingSnippet {...props} />);
}
