import type robots from "../../../../web/app/robots";

/** Match the existing metadata-route text representation, including its final newline. */
export function serializeRobots(value: ReturnType<typeof robots>): string {
  const groups = Array.isArray(value.rules) ? value.rules : [value.rules];
  let body = "";
  for (const rule of groups) {
    for (const agent of list(rule.userAgent ?? "*")) body += `User-Agent: ${agent}\n`;
    for (const path of list(rule.allow)) body += `Allow: ${path}\n`;
    for (const path of list(rule.disallow)) body += `Disallow: ${path}\n`;
    if (rule.crawlDelay !== undefined) body += `Crawl-delay: ${rule.crawlDelay}\n`;
    body += "\n";
  }
  if (value.host) body += `Host: ${value.host}\n`;
  for (const sitemap of list(value.sitemap)) body += `Sitemap: ${sitemap}\n`;
  return body;
}
function list(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
