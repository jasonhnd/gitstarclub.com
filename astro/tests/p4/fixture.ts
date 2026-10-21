import { fixtureRecords } from "../../scripts/fixture";

/** Bounded synthetic data, served identically to web and the local Astro Worker. */
export function organizationRecords() {
  const records = fixtureRecords();
  const put = (key: string, value: unknown) => {
    const body = JSON.stringify(value);
    records.set(key, body);
    records.set(`views/fixture-v1/${key}`, body);
  };
  const orgs = Object.fromEntries(Array.from({ length: 103 }, (_, index) => {
    const login = index === 0 ? "example" : `fixture-${String(index).padStart(3, "0")}`;
    return [login, { login, owner_type: index % 2 ? "User" : "Organization", repo_count: 2, current_stars_sum: 25000 - index * 100 }];
  }));
  put("lookup/orgs.json", orgs);
  put("lookup/repos.json", {
    1: { owner: "example", name: "repo", full_name: "example/repo", owner_type: "Organization", language: "TypeScript", current_stars: 20000 },
    2: { owner: "example", name: "tools", full_name: "example/tools", owner_type: "Organization", language: null, current_stars: 5000 },
  });
  put("entity/org/example.json", {
    ...orgs.example, members: [2, 999, 1],
    curve: { monthly: [["2025-01", 10000, 10000], ["2025-02", 5000, 15000], ["2026-01", 10000, 25000]], recent_daily: [["2026-07-15", 120], ["2026-07-16", -10]] },
    rank_history: { month: [["2025-02", 3], ["2026-01", 2]] },
  });
  put("entity/org/fixture-001.json", { ...orgs["fixture-001"], members: [], curve: { monthly: [], recent_daily: [] } });
  return records;
}
