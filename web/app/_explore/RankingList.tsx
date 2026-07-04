import { type Locale } from "@/lib/i18n";
import { RepositoryRankingTable, type RepositoryRankingTableLabels } from "./SemanticDataTable";

export type Row = {
  owner: string;
  name: string;
  lang: string | null;
  total: number;
  gained?: number;
  rate?: number;
  crossedDay?: number;
};
type Variant = "gained" | "rate" | "crossed" | "total";

export function RankingList({
  rows,
  variant = "gained",
  locale,
  startRank = 1,
  tableCaption,
  labels,
}: {
  rows: Row[];
  variant?: Variant;
  locale?: Locale;
  startRank?: number;
  tableCaption?: string;
  labels?: Partial<RepositoryRankingTableLabels>;
}) {
  return <RepositoryRankingTable rows={rows} variant={variant} startRank={startRank} caption={tableCaption} labels={labels} locale={locale} />;
}
