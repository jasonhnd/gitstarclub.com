import { type Locale } from "@/lib/i18n";
import { RepositoryRankingTable } from "./SemanticDataTable";

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
  startRank = 1,
  tableCaption,
}: {
  rows: Row[];
  variant?: Variant;
  locale?: Locale;
  startRank?: number;
  tableCaption?: string;
}) {
  return <RepositoryRankingTable rows={rows} variant={variant} startRank={startRank} caption={tableCaption} />;
}
