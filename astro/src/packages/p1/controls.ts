function feedback(button: HTMLButtonElement, label: string) {
  const text = Array.from(button.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  if (!text) return;
  const previous = text.textContent;
  text.textContent = label;
  window.setTimeout(() => { text.textContent = previous; }, 1600);
}
async function copy(button: HTMLButtonElement, value: string, label: string) {
  try { await navigator.clipboard.writeText(value); feedback(button, label); } catch { /* Match existing clipboard permission behavior. */ }
}
for (const island of document.querySelectorAll<HTMLElement>("p1-share,p1-snippet")) {
  const props = JSON.parse(island.dataset.props ?? "{}");
  const buttons = island.querySelectorAll<HTMLButtonElement>("button");
  if (island.localName === "p1-share") {
    buttons[0]?.addEventListener("click", () => { void copy(buttons[0], props.url ?? window.location.href, props.labels.copied); });
    buttons[1]?.addEventListener("click", () => {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(props.text ?? "")}&url=${encodeURIComponent(props.url ?? window.location.href)}`, "_blank", "noopener,noreferrer");
    });
  } else {
    buttons[0]?.addEventListener("click", () => { void copy(buttons[0], props.copyText, props.labels.copied); });
    buttons[1]?.addEventListener("click", () => { void copy(buttons[1], props.embedHtml, props.labels.embedCopied); });
  }
}
