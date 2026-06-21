import { stringifyJsonForScript } from "@/lib/json-script";

// Renders a schema.org JSON-LD <script>. Server-rendered into the initial HTML so both
// JS-executing crawlers and HTML-limited bots get it (SEO §3.4 / §6).
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: stringifyJsonForScript(data) }} />;
}
