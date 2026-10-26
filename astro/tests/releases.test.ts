import { expect, test } from "bun:test";
import { loadRelease, publicRecordUrl, releasePath } from "../src/packages/releases/data";
import { RELEASE_ID, PREVIOUS_ID, releaseRecords } from "./releases-fixture";
import { releaseCopy } from "../../web/lib/i18n/dictionaries/releases";
import { LOCALES, classifyRoute } from "../src/lib/i18n";
import { pageRoute } from "../src/lib/routing";

function reader(records: Map<string, string>) {
  return { async raw<T>(key: string, schema: { parse(value: unknown): T }): Promise<T | null> {
    const body = records.get(key);
    return body === undefined ? null : schema.parse(JSON.parse(body));
  } };
}
test("release reader uses global history and only links existing records belonging to the run", async () => {
  const data = reader(releaseRecords());
  const current = await loadRelease(data, RELEASE_ID);
  expect(current?.release.tracked_repo_count).toBe(12345);
  expect(current?.records.map((record) => record.kind)).toEqual(["metadata", "pointer", "recovery", "health"]);
  const previous = await loadRelease(data, PREVIOUS_ID);
  expect(previous?.release.prev_version).toBeNull();
  expect(previous?.release.data_as_of.generated_at).toBeUndefined();
  expect(previous?.records).toEqual([]);
});
test("absent history, empty history and unknown id return no release", async () => {
  for (const records of [new Map<string, string>(), new Map([["views/releases.json", '{"schema_ver":1,"releases":[]}']]), releaseRecords()]) {
    expect(await loadRelease(reader(records), "unknown")).toBeNull();
  }
});
test("invalid history fails explicitly but invalid optional records are omitted", async () => {
  const records = releaseRecords();
  records.set("views/latest.json", "invalid");
  expect((await loadRelease(reader(records), RELEASE_ID))?.records.map((r) => r.kind)).not.toContain("pointer");
  records.set("views/releases.json", "invalid");
  await expect(loadRelease(reader(records), RELEASE_ID)).rejects.toThrow();
});
test("release paths preserve ids as a single encoded segment and public URLs require an HTTP origin", () => {
  expect(releasePath("run /?#")).toBe("/releases/run%20%2F%3F%23");
  expect(publicRecordUrl("https://data.example.com/prefix", "views/latest.json")).toBe("https://data.example.com/prefix/views/latest.json");
  for (const base of ["", "javascript:alert(1)", "https://user:password@data.example.com", "https://data.example.com/?secret=x"]) expect(publicRecordUrl(base, "views/latest.json")).toBeNull();
});
test("all locales have release copy and recognize release routes instead of repository routes", () => {
  for (const locale of LOCALES) {
    expect(Object.values(releaseCopy[locale]).every((value) => value.length > 0)).toBe(true);
    const path = `${locale === "en" ? "" : `/${locale}`}/releases/${RELEASE_ID}`;
    expect(classifyRoute(path).kind).toBe(locale === "en" ? "reserved-route" : "localized-reserved-route");
    expect(pageRoute(path)).toEqual({ locale, path: `/releases/${RELEASE_ID}` });
  }
});
