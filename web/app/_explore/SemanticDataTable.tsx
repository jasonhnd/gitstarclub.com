import type { Row } from "./RankingList";

type RankingVariant = "gained" | "rate" | "crossed" | "total";

export type OrganizationSummaryRow = {
  rank?: number | null;
  login: string;
  owner_type?: string;
  repo_count: number;
  current_stars_sum: number;
};

export type CategorySummaryRow = {
  id: string;
  dimension: string;
  slug: string;
  label: string;
  count: number;
  path?: string;
};

export function RepositoryRankingTable({
  rows,
  variant = "gained",
  startRank = 1,
  caption = "Repository rankings",
}: {
  rows: Row[];
  variant?: RankingVariant;
  startRank?: number;
  caption?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <table className="sr-only" data-semantic-table="repository-rankings">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Repository</th>
          <th scope="col">Language</th>
          {variant !== "total" && <th scope="col">{metricHeader(variant)}</th>}
          <th scope="col">Total stars</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.owner}/${row.name}`}>
            <td>{startRank + index}</td>
            <th scope="row">{row.owner}/{row.name}</th>
            <td>{row.lang ?? "Unknown"}</td>
            {variant !== "total" && <td>{metricValue(row, variant)}</td>}
            <td>{row.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OrganizationRankingTable({
  rows,
  startRank = 1,
  caption = "Organization rankings",
}: {
  rows: OrganizationSummaryRow[];
  startRank?: number;
  caption?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <table className="sr-only" data-semantic-table="organization-rankings">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Owner</th>
          <th scope="col">Owner type</th>
          <th scope="col">Tracked repositories</th>
          <th scope="col">Total stars</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.login}>
            <td>{row.rank ?? startRank + index}</td>
            <th scope="row">{row.login}</th>
            <td>{row.owner_type ?? "Unknown"}</td>
            <td>{row.repo_count}</td>
            <td>{row.current_stars_sum}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CategorySummaryTable({ rows, caption = "Repository categories" }: { rows: CategorySummaryRow[]; caption?: string }) {
  if (rows.length === 0) return null;

  return (
    <table className="sr-only" data-semantic-table="repository-categories">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Dimension</th>
          <th scope="col">Slug</th>
          <th scope="col">Tracked repositories</th>
          <th scope="col">Path</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.label}</th>
            <td>{row.dimension}</td>
            <td>{row.slug}</td>
            <td>{row.count}</td>
            <td>{row.path ?? `/categories/${row.dimension}/${row.slug}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function metricHeader(variant: Exclude<RankingVariant, "total">): string {
  switch (variant) {
    case "rate":
      return "Growth rate percent";
    case "crossed":
      return "10k crossing day";
    case "gained":
      return "Stars gained";
  }
}

function metricValue(row: Row, variant: Exclude<RankingVariant, "total">): number | string {
  switch (variant) {
    case "rate":
      return row.rate ?? "";
    case "crossed":
      return row.crossedDay ?? "";
    case "gained":
      return row.gained ?? 0;
  }
}
