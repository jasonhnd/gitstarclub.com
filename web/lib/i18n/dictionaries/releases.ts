import type { Locale } from "../locales";

type ReleaseCopy = {
  title: string; description: string; id: string; published: string; previous: string;
  none: string; tracked: string; skipped: string; dates: string; seam: string;
  generated: string; backfilled: string; month: string; week: string;
  unavailable: string; records: string; noRecords: string;
  metadata: string; pointer: string; recovery: string; health: string;
};

export const releaseCopy: Record<Locale, ReleaseCopy> = {
  en: {
    title: "Release", description: "A published, precomputed snapshot. Results are deterministic; this is not live search or AI.",
    id: "Release ID", published: "Published time (UTC)", previous: "Previous version", none: "No previous version",
    tracked: "Tracked repositories", skipped: "Skipped repositories", dates: "Data as of, by layer",
    seam: "Archive boundary", generated: "Snapshot generated (UTC)", backfilled: "Archive backfilled (UTC)",
    month: "Monthly data through", week: "Weekly data through", unavailable: "Not recorded",
    records: "Public records", noRecords: "No public records are currently available for this run.",
    metadata: "Snapshot metadata", pointer: "Published pointer", recovery: "Latest successful publication", health: "Refresh health",
  },
  ja: {
    title: "リリース", description: "事前集計して公開したスナップショットです。結果は再現可能で、リアルタイム検索やAIではありません。",
    id: "リリースID", published: "公開日時（UTC）", previous: "前のバージョン", none: "前のバージョンはありません",
    tracked: "追跡対象リポジトリ", skipped: "スキップしたリポジトリ", dates: "レイヤー別のデータ基準日",
    seam: "アーカイブの境界日", generated: "スナップショット生成日時（UTC）", backfilled: "アーカイブ補完日時（UTC）",
    month: "月次データの収録期間", week: "週次データの収録期間", unavailable: "記録なし",
    records: "公開記録", noRecords: "この実行の公開記録は現在利用できません。",
    metadata: "スナップショットのメタデータ", pointer: "公開先の参照記録", recovery: "直近の公開成功記録", health: "更新の状態",
  },
  zh: {
    title: "发布版本", description: "预先计算并发布的数据快照。结果可复现，不是实时搜索或AI。",
    id: "发布ID", published: "发布时间（UTC）", previous: "上一版本", none: "无上一版本", tracked: "跟踪的仓库", skipped: "跳过的仓库",
    dates: "各层数据截止时间", seam: "归档分界日期", generated: "快照生成时间（UTC）", backfilled: "归档补全时间（UTC）",
    month: "月度数据截至", week: "周度数据截至", unavailable: "未记录", records: "公开记录", noRecords: "当前没有此运行的公开记录。",
    metadata: "快照元数据", pointer: "发布指向记录", recovery: "最近成功发布记录", health: "刷新状态",
  },
  "zh-TW": {
    title: "發布版本", description: "預先計算並發布的資料快照。結果可重現，並非即時搜尋或AI。",
    id: "發布ID", published: "發布時間（UTC）", previous: "上一版本", none: "無上一版本", tracked: "追蹤的儲存庫", skipped: "略過的儲存庫",
    dates: "各層資料截止時間", seam: "封存分界日期", generated: "快照產生時間（UTC）", backfilled: "封存補全時間（UTC）",
    month: "月度資料截至", week: "週度資料截至", unavailable: "未記錄", records: "公開記錄", noRecords: "目前沒有此執行的公開記錄。",
    metadata: "快照中繼資料", pointer: "發布指向記錄", recovery: "最近成功發布記錄", health: "更新狀態",
  },
  ko: {
    title: "릴리스", description: "미리 계산하여 게시한 스냅샷입니다. 결과는 재현 가능하며 실시간 검색이나 AI가 아닙니다.",
    id: "릴리스 ID", published: "게시 시간 (UTC)", previous: "이전 버전", none: "이전 버전 없음", tracked: "추적 저장소", skipped: "건너뛴 저장소",
    dates: "계층별 데이터 기준일", seam: "아카이브 경계일", generated: "스냅샷 생성 시간 (UTC)", backfilled: "아카이브 보완 시간 (UTC)",
    month: "월별 데이터 기준 기간", week: "주별 데이터 기준 기간", unavailable: "기록 없음", records: "공개 기록", noRecords: "현재 이 실행의 공개 기록이 없습니다.",
    metadata: "스냅샷 메타데이터", pointer: "게시 참조 기록", recovery: "최근 게시 성공 기록", health: "새로 고침 상태",
  },
  es: {
    title: "Publicación", description: "Una instantánea publicada y precalculada. Los resultados son deterministas; no es una búsqueda en vivo ni IA.",
    id: "ID de publicación", published: "Fecha de publicación (UTC)", previous: "Versión anterior", none: "Sin versión anterior", tracked: "Repositorios seguidos", skipped: "Repositorios omitidos",
    dates: "Fechas de los datos por capa", seam: "Límite del archivo", generated: "Instantánea generada (UTC)", backfilled: "Archivo completado (UTC)",
    month: "Datos mensuales hasta", week: "Datos semanales hasta", unavailable: "Sin registro", records: "Registros públicos", noRecords: "Actualmente no hay registros públicos disponibles para esta ejecución.",
    metadata: "Metadatos de la instantánea", pointer: "Referencia publicada", recovery: "Última publicación exitosa", health: "Estado de actualización",
  },
  fr: {
    title: "Publication", description: "Un instantané publié et précalculé. Les résultats sont déterministes ; ce ne sont ni des recherches en direct ni de l’IA.",
    id: "ID de publication", published: "Date de publication (UTC)", previous: "Version précédente", none: "Aucune version précédente", tracked: "Dépôts suivis", skipped: "Dépôts ignorés",
    dates: "Dates des données par couche", seam: "Limite de l’archive", generated: "Instantané généré (UTC)", backfilled: "Archive complétée (UTC)",
    month: "Données mensuelles jusqu’à", week: "Données hebdomadaires jusqu’à", unavailable: "Non renseigné", records: "Documents publics", noRecords: "Aucun document public n’est actuellement disponible pour cette exécution.",
    metadata: "Métadonnées de l’instantané", pointer: "Référence publiée", recovery: "Dernière publication réussie", health: "État de l’actualisation",
  },
};
