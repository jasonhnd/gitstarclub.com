import type { AnswerCapsuleContent } from "@/lib/geo-capsules";

export function AnswerCapsule({ capsule, className = "" }: { capsule: AnswerCapsuleContent; className?: string }) {
  return (
    <section aria-label="Answer capsule" className={`rounded-2xl border border-outline-variant bg-surface-container px-4 py-4 ${className}`}>
      <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">Answer capsule</p>
      <p className="mt-3 max-w-[70ch] text-[0.98rem] leading-relaxed text-on-surface">{capsule.text}</p>
      <dl className="mt-4 grid gap-3 border-t border-outline-variant pt-3 font-mono text-[0.75rem] sm:grid-cols-2">
        <div>
          <dt className="uppercase tracking-wider text-on-surface-variant">Data as of</dt>
          <dd className="mt-1 font-semibold text-on-surface">{capsule.asOf}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-on-surface-variant">Source</dt>
          <dd className="mt-1 font-semibold text-on-surface">{capsule.source}</dd>
        </div>
      </dl>
    </section>
  );
}
