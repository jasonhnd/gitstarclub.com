/** Enhance only Copy; the disclosure and citation work without JavaScript. */
class AboutThisData extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    const button = this.querySelector<HTMLButtonElement>("[data-copy]");
    const citation = this.querySelector<HTMLElement>("[data-citation]");
    const status = this.querySelector<HTMLElement>("[data-copy-status]");
    if (!button || !citation || !status) return;
    this.dataset.ready = "true";
    button.hidden = false;
    button.addEventListener("click", async () => {
      status.textContent = "";
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(citation.textContent ?? "");
        status.textContent = button.dataset.copied ?? "";
      } catch {
        citation.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(citation);
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = button.dataset.unavailable ?? "";
      }
    });
  }
}
if (!customElements.get("gsc-about-data")) customElements.define("gsc-about-data", AboutThisData);
