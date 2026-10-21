import { CategoryRegistry, Meta, OrgEntity, OrgsLookup, ReposLookup } from "../../../../web/lib/contracts";
import { getDictionary } from "../../../../web/lib/i18n";
import { localizedPath, toBcp47Locale } from "../../../../web/lib/i18n/routing";
import { githubLogin } from "../../../../web/lib/public-params";
import { parsePositivePage } from "../../../../web/lib/pagination";
import { formatTemplate } from "../../../../web/lib/template-format";
import { orgIndexPageCount, orgIndexPath, orgIndexRows } from "../../../../web/app/o/org-index-data";
import { pageRoute } from "../../lib/routing";
import type { pageData } from "../../lib/data";

type Data = Pick<ReturnType<typeof pageData>, "base">;
const missing = () => new Response("Not found", { status: 404 });

export async function organizationIndex(data: Data, pathname: string, rawPage?: string) {
  const route = pageRoute(pathname);
  const page = rawPage === undefined ? 1 : parsePositivePage(rawPage);
  if (!route || !/^\/o(?:\/page\/[^/]+)?$/.test(route.path) || !page) return missing();
  const { locale } = route;
  if (rawPage !== undefined && page === 1) {
    return new Response(null, { status: 308, headers: { Location: localizedPath(locale, orgIndexPath()) } });
  }
  const orgs = await data.base("lookup/orgs.json", OrgsLookup);
  if (page > orgIndexPageCount(orgIndexRows(orgs).length)) return missing();
  const t = await getDictionary(locale);
  return {
    locale, page, orgs, t, canonicalPath: orgIndexPath(page),
    title: page === 1 ? t.org.indexTitle : formatTemplate(t.org.indexPageTitle, { page: String(page) }),
    description: t.org.indexDescription,
  };
}

export async function organizationDetail(data: Data, pathname: string, rawLogin: string) {
  const route = pageRoute(pathname);
  const login = githubLogin(rawLogin);
  if (!route || !/^\/o\/[^/]+$/.test(route.path) || !login) return missing();
  const { locale } = route;
  const [org, lookup, registry, meta, t] = await Promise.all([
    data.base(`entity/org/${login}.json`, OrgEntity),
    data.base("lookup/repos.json", ReposLookup),
    data.base("categories/registry.json", CategoryRegistry),
    data.base("meta.json", Meta),
    getDictionary(locale),
  ]);
  if (!org) return missing();
  const language = toBcp47Locale(locale);
  return {
    locale, org, lookup, registry, meta, t, canonicalPath: `/o/${org.login}`,
    title: formatTemplate(t.org.metaTitle, { login: org.login, kind: org.owner_type === "Organization" ? t.org.organization : t.org.developer }),
    description: formatTemplate(t.org.metaDescription, {
      login: org.login, repos: org.repo_count.toLocaleString(language), stars: org.current_stars_sum.toLocaleString(language),
    }),
  };
}
