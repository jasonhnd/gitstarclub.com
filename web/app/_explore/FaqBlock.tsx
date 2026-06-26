import { JsonLd } from "@/app/_explore/JsonLd";
import { faqPageLd, type FaqItem } from "@/lib/jsonld";

export function FaqBlock({
  items,
  path,
  locale,
  className = "",
}: {
  items: readonly FaqItem[];
  path: string;
  locale: string;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <>
      <JsonLd data={faqPageLd(items, path, locale)} />
      <section aria-labelledby="faq-heading" className={`mt-[clamp(2rem,4vw,3rem)] ${className}`}>
        <h2 id="faq-heading" className="text-[1.25rem] font-extrabold tracking-tight text-on-surface">
          Frequently asked questions
        </h2>
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <article key={item.question} className="rounded-lg bg-surface-container px-4 py-4">
              <h3 className="text-[1rem] font-extrabold text-on-surface">{item.question}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-on-surface-variant">{item.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
