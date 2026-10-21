import { createElement } from "react";
import { ShareButton as ExistingShareButton, type ShareButtonLabels } from "@/app/_explore/ShareButton";
import { SnippetActions as ExistingSnippetActions, type SnippetActionLabels } from "@/app/_explore/SnippetActions";
export type { SnippetActionLabels };

// Native islands retain the existing static control markup without hydrating a page.
export function ShareButton(props: { text?: string; labels: ShareButtonLabels; url?: string }) {
  return createElement("p1-share", { "data-props": JSON.stringify(props), style: { display: "contents" } }, <ExistingShareButton {...props} />);
}
export function SnippetActions(props: { copyText: string; embedHtml: string; labels: SnippetActionLabels }) {
  return createElement("p1-snippet", { "data-props": JSON.stringify(props), style: { display: "contents" } }, <ExistingSnippetActions {...props} />);
}
