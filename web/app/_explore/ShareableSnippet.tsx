import { SnippetActions } from "@/app/_explore/SnippetActions";
import type { ShareableSnippetContent } from "@/lib/shareable-snippets";

export function ShareableSnippet({ snippet, className = "" }: { snippet: ShareableSnippetContent; className?: string }) {
  return (
    <section aria-label={`${snippet.title} shareable snippet`} className={`rounded-2xl border border-outline-variant bg-surface-container px-4 py-4 ${className}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">Shareable snippet</p>
          <h2 className="mt-2 text-[1.05rem] font-extrabold text-on-surface">{snippet.title}</h2>
          <p className="mt-3 max-w-[72ch] text-[0.98rem] leading-relaxed text-on-surface">{snippet.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {snippet.links.map((link) => (
              <a
                key={`${link.label}:${link.href}`}
                href={link.href}
                className="rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
        <div className="shrink-0 md:pt-6">
          <SnippetActions copyText={snippet.copyText} embedHtml={snippet.embedHtml} />
        </div>
      </div>
    </section>
  );
}
