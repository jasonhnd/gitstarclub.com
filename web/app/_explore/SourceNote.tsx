/** Shared presentation for ranking data caveats. */
export function SourceNote({ text }: { text: string | undefined }) {
  return text ? <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">{text}</p> : null;
}
