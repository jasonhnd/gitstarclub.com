import type { AnswerCapsuleContent } from "@/lib/geo-capsules";

export type AnswerCapsuleLabels = {
  ariaLabel: string;
  eyebrow: string;
  dataAsOf: string;
  source: string;
};

const DEFAULT_LABELS: AnswerCapsuleLabels = {
  ariaLabel: "Answer capsule",
  eyebrow: "Answer capsule",
  dataAsOf: "Data as of",
  source: "Source",
};

type AnswerCapsuleLabelProps = Partial<AnswerCapsuleLabels> & {
  heading?: string;
};

export function AnswerCapsule({
  capsule,
  className = "",
  labels = DEFAULT_LABELS,
}: {
  capsule: AnswerCapsuleContent;
  className?: string;
  labels?: AnswerCapsuleLabelProps;
}) {
  const text = {
    ariaLabel: labels.ariaLabel ?? labels.heading ?? DEFAULT_LABELS.ariaLabel,
    eyebrow: labels.eyebrow ?? labels.heading ?? DEFAULT_LABELS.eyebrow,
    dataAsOf: labels.dataAsOf ?? DEFAULT_LABELS.dataAsOf,
    source: labels.source ?? DEFAULT_LABELS.source,
  };

  return (
    <section aria-label={text.ariaLabel} className={`rounded-2xl border border-outline-variant bg-surface-container px-4 py-4 ${className}`}>
      <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{text.eyebrow}</p>
      <p className="mt-3 max-w-[70ch] text-[0.98rem] leading-relaxed text-on-surface">{capsule.text}</p>
      <dl className="mt-4 grid gap-3 border-t border-outline-variant pt-3 font-mono text-[0.75rem] sm:grid-cols-2">
        <div>
          <dt className="uppercase tracking-wider text-on-surface-variant">{text.dataAsOf}</dt>
          <dd className="mt-1 font-semibold text-on-surface">{capsule.asOf}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-on-surface-variant">{text.source}</dt>
          <dd className="mt-1 font-semibold text-on-surface">{capsule.source}</dd>
        </div>
      </dl>
    </section>
  );
}
