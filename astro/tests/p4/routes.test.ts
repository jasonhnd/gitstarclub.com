import { describe, expect, test } from "bun:test";
import { organizationIndex, organizationDetail } from "../../src/packages/p4/data";
import { organizationRecords } from "./fixture";
import { LOCALES, localizedPath } from "../../src/lib/i18n";

function reader(records = organizationRecords()) {
  const reads: string[] = [];
  return {
    reads,
    async base<T>(path: string, schema: { parse(value: unknown): T }): Promise<T | null> {
      reads.push(path);
      const body = records.get(path);
      return body === undefined ? null : schema.parse(JSON.parse(body));
    },
  };
}

describe("P4 route loaders", () => {
  for (const locale of LOCALES) {
    test(`${locale}: directory, second page and detail use the same published contracts`, async () => {
      const data = reader();
      const index = await organizationIndex(data, localizedPath(locale, "/o"));
      const second = await organizationIndex(data, localizedPath(locale, "/o/page/2"), "2");
      const detail = await organizationDetail(data, localizedPath(locale, "/o/example"), "example");
      if (index instanceof Response || second instanceof Response || detail instanceof Response) throw new Error("Expected valid page data");
      expect(index.locale).toBe(locale);
      expect(Object.keys(index.orgs ?? {})).toHaveLength(103);
      expect(second.page).toBe(2);
      expect(second.canonicalPath).toBe("/o/page/2");
      expect(detail.org.login).toBe("example");
      expect(detail.title).toContain("example");
      expect(data.reads).toEqual(["lookup/orgs.json", "lookup/orgs.json", "entity/org/example.json", "lookup/repos.json", "categories/registry.json", "meta.json"]);
      const redirect = await organizationIndex(data, localizedPath(locale, "/o/page/1"), "1");
      expect(redirect).toBeInstanceOf(Response);
      expect((redirect as Response).status).toBe(308);
      expect((redirect as Response).headers.get("location")).toBe(localizedPath(locale, "/o"));
    });
  }
  test("invalid page syntax and owner segments never read storage", async () => {
    const data = reader();
    for (const page of ["0", "01", "-1", "1.5", "Infinity", "9007199254740992"]) {
      expect((await organizationIndex(data, `/o/page/${page}`, page) as Response).status).toBe(404);
    }
    for (const login of ["-bad", "bad-", "a/b", "%65xample", "a".repeat(40)]) {
      expect((await organizationDetail(data, `/o/${login}`, login) as Response).status).toBe(404);
    }
    expect((await organizationIndex(data, "/xx/o") as Response).status).toBe(404);
    expect((await organizationDetail(data, "/xx/o/example", "example") as Response).status).toBe(404);
    expect(data.reads).toEqual([]);
  });
  test("missing entities and out-of-range pages are 404; an empty directory still renders", async () => {
    expect((await organizationDetail(reader(), "/o/missing", "missing") as Response).status).toBe(404);
    expect((await organizationIndex(reader(), "/o/page/3", "3") as Response).status).toBe(404);
    const result = await organizationIndex(reader(new Map()), "/o");
    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) expect(result.orgs).toBeNull();
  });
});
