import type { ReactNode } from "react";

export type AnswerCapsuleBaseProps = {
  summary: ReactNode;
  dataAsOf: string;
  source: string;
  href?: string;
  supportingFacts?: readonly ReactNode[];
  className?: string;
};

const missingDataAsOf = "Missing data-as-of date";
const missingSource = "Missing source";

export function AnswerCapsuleBase({
  summary,
  dataAsOf,
  source,
  href,
  supportingFacts = [],
  className = "",
}: AnswerCapsuleBaseProps) {
  const hasDataAsOf = dataAsOf.trim().length > 0;
  const hasSource = source.trim().length > 0;
  const normalizedHref = href?.trim();
  const metadataState = missingMetadataState(hasDataAsOf, hasSource);

  return (
    <article
      aria-label="Answer capsule"
      className={`rounded-2xl border border-outline-variant bg-surface-container px-4 py-4 text-on-surface shadow-[var(--elev-1)] ${className}`}
      data-answer-capsule=""
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">Answer</p>
        {metadataState ? (
          <p className="rounded-full bg-tertiary-container px-2.5 py-1 font-mono text-[0.72rem] font-semibold text-on-tertiary-container" role="status">
            {metadataState}
          </p>
        ) : null}
      </header>

      <div className="mt-3 max-w-[72ch] text-[1rem] leading-relaxed text-on-surface">{summary}</div>

      {supportingFacts.length > 0 ? (
        <ul className="mt-4 grid gap-2 border-t border-outline-variant pt-4 text-[0.92rem] leading-relaxed text-on-surface-variant" aria-label="Supporting facts">
          {supportingFacts.map((fact, index) => (
            <li key={index} className="flex gap-2">
              <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="mt-4 border-t border-outline-variant pt-3">
        <dl className="grid gap-3 font-mono text-[0.75rem] sm:grid-cols-2">
          <div>
            <dt className="uppercase tracking-wider text-on-surface-variant">Data as of</dt>
            <dd className="mt-1 font-semibold text-on-surface">{hasDataAsOf ? dataAsOf : missingDataAsOf}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider text-on-surface-variant">Source</dt>
            <dd className="mt-1 font-semibold text-on-surface">
              {hasSource && normalizedHref ? (
                <a className="text-primary underline underline-offset-4 hover:text-on-surface" href={normalizedHref}>
                  {source}
                </a>
              ) : hasSource ? (
                source
              ) : (
                missingSource
              )}
            </dd>
          </div>
        </dl>
      </footer>
    </article>
  );
}

function missingMetadataState(hasDataAsOf: boolean, hasSource: boolean): string | null {
  if (!hasDataAsOf && !hasSource) return "Missing date and source";
  if (!hasDataAsOf) return missingDataAsOf;
  if (!hasSource) return missingSource;
  return null;
}
