type Controls =
  | { kind: "share"; text?: string; url?: string; labels: { copied: string } }
  | { kind: "snippet"; snippet: { copyText: string; embedHtml: string }; labels: { copied: string; embedCopied: string } };

/** An interactive island for share/copy only; repository facts and SVG curves stay static. */
class RepositoryShare extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = "true";
    const controls = JSON.parse(this.dataset.controls ?? "null") as Controls | null;
    if (!controls) return;
    const buttons = this.querySelectorAll("button");
    buttons.forEach((button, index) => {
      const text = Array.from(button.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const original = text?.textContent;
      let timer: ReturnType<typeof setTimeout> | undefined;
      button.addEventListener("click", async () => {
        if (controls.kind === "share" && index === 1) {
          window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(controls.text ?? "")}&url=${encodeURIComponent(controls.url ?? window.location.href)}`, "_blank", "noopener,noreferrer");
          return;
        }
        if (!navigator.clipboard) return;
        const value = controls.kind === "share" ? controls.url ?? window.location.href : index === 0 ? controls.snippet.copyText : controls.snippet.embedHtml;
        try {
          await navigator.clipboard.writeText(value);
          if (text) text.textContent = controls.kind === "snippet" && index === 1 ? controls.labels.embedCopied : controls.labels.copied;
          clearTimeout(timer);
          timer = setTimeout(() => { if (text) text.textContent = original ?? ""; }, 1600);
        } catch { /* Match existing controls when clipboard permissions are unavailable. */ }
      });
    });
  }
}
if (!customElements.get("gsc-repo-share")) customElements.define("gsc-repo-share", RepositoryShare);
