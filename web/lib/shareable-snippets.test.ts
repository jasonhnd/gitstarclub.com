import { describe, expect, test } from "bun:test";
import { absoluteSnippetUrl, buildShareableSnippet, buildWeeklyMoversSnippet, type ShareableSnippetContent } from "./shareable-snippets";

import { buildLocalizedRepoMilestoneSnippet } from "@/app/_localized/repo";
import { buildLocalizedOrgTotalSnippet } from "@/app/_localized/org";
import { getDictionary, type Locale } from "@/lib/i18n";
import { formatConjunction, formatSignedStars, formatTemplate } from "./template-format";

const asOf = "June 24, 2026";

describe("shareable snippets", () => {
  test("builds weekly mover snippets with canonical production links", () => {
    const snippet = buildWeeklyMoversSnippet({
      period: "2026-W26",
      asOf,
      path: "/rankings/2026/W26",
      rows: [
        { owner: "react", name: "react", gained: 1200 },
        { owner: "vuejs", name: "vue", gained: 800 },
        { owner: "angular", name: "angular", gained: 500 },
      ],
    });

    expect(snippet?.text).toBe(
      "As of June 24, 2026, react/react led GitStarClub's 2026-W26 weekly movers with +1.2k stars gained. vuejs/vue (+800) and angular/angular (+500) followed in the tracked weekly ranking. Source: GitStarClub 2026-W26 weekly rankings.",
    );
    expect(snippet?.links.map((link) => link.href)).toEqual([
      "https://gitstarclub.com/rankings/2026/W26",
      "https://gitstarclub.com/react/react",
      "https://gitstarclub.com/vuejs/vue",
      "https://gitstarclub.com/angular/angular",
    ]);
    expect(snippet?.embedHtml).toContain('<blockquote cite="https://gitstarclub.com/rankings/2026/W26">');
  });

  test("normalizes canonical urls", () => {
    expect(absoluteSnippetUrl("/")).toBe("https://gitstarclub.com/");
    expect(absoluteSnippetUrl("rankings")).toBe("https://gitstarclub.com/rankings");
    expect(absoluteSnippetUrl("https://example.com/source")).toBe("https://example.com/source");
  });
});

// Captured from the live page builders at pre b9650f0, before extraction.
const localizedFixtures: Record<Locale, {repo: ShareableSnippetContent; org: ShareableSnippetContent}> = {
  "en": {
    "repo": {
      "kind": "repo-milestones",
      "title": "example/repo milestones",
      "text": "As of 2026-06-24, GitStarClub records example/repo crossing 10k in March 2020 and 50k in June 2024. These milestone dates come from frozen repository fields and link back to the matching monthly ranking pages. Source: GitStarClub repository star history.",
      "links": [
        {
          "label": "example/repo star history",
          "href": "https://gitstarclub.com/example/repo"
        },
        {
          "label": "10k ranking month",
          "href": "https://gitstarclub.com/rankings/2020/3"
        },
        {
          "label": "50k ranking month",
          "href": "https://gitstarclub.com/rankings/2024/6"
        }
      ],
      "copyText": "As of 2026-06-24, GitStarClub records example/repo crossing 10k in March 2020 and 50k in June 2024. These milestone dates come from frozen repository fields and link back to the matching monthly ranking pages. Source: GitStarClub repository star history.\nexample/repo star history: https://gitstarclub.com/example/repo\n10k ranking month: https://gitstarclub.com/rankings/2020/3\n50k ranking month: https://gitstarclub.com/rankings/2024/6",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/example/repo\"><p><strong>example/repo milestones</strong></p><p>As of 2026-06-24, GitStarClub records example/repo crossing 10k in March 2020 and 50k in June 2024. These milestone dates come from frozen repository fields and link back to the matching monthly ranking pages. Source: GitStarClub repository star history.</p><p><a href=\"https://gitstarclub.com/example/repo\">Source: example/repo star history</a></p></blockquote>"
    },
    "org": {
      "kind": "org-total",
      "title": "example organization total",
      "text": "As of 2026-06-24, example has 400.0k total GitHub stars across 1,234 tracked repositories on GitStarClub. Top tracked repositories include example/one (140.0k stars), example/two (44.0k stars), and example/three (32.0k stars). Source: GitStarClub organization star history.",
      "links": [
        {
          "label": "example star history",
          "href": "https://gitstarclub.com/o/example"
        },
        {
          "label": "example/one",
          "href": "https://gitstarclub.com/example/one"
        },
        {
          "label": "example/two",
          "href": "https://gitstarclub.com/example/two"
        },
        {
          "label": "example/three",
          "href": "https://gitstarclub.com/example/three"
        }
      ],
      "copyText": "As of 2026-06-24, example has 400.0k total GitHub stars across 1,234 tracked repositories on GitStarClub. Top tracked repositories include example/one (140.0k stars), example/two (44.0k stars), and example/three (32.0k stars). Source: GitStarClub organization star history.\nexample star history: https://gitstarclub.com/o/example\nexample/one: https://gitstarclub.com/example/one\nexample/two: https://gitstarclub.com/example/two\nexample/three: https://gitstarclub.com/example/three",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/o/example\"><p><strong>example organization total</strong></p><p>As of 2026-06-24, example has 400.0k total GitHub stars across 1,234 tracked repositories on GitStarClub. Top tracked repositories include example/one (140.0k stars), example/two (44.0k stars), and example/three (32.0k stars). Source: GitStarClub organization star history.</p><p><a href=\"https://gitstarclub.com/o/example\">Source: example star history</a></p></blockquote>"
    }
  },
  "ja": {
    "repo": {
      "kind": "repo-milestones",
      "title": "example/repo のマイルストーン",
      "text": "2026-06-24 時点で、GitStarClub は example/repo が 2020年3月 に 10k、2024年6月 に 50k を超えたことを記録しています。これらのマイルストーン日は固定済みリポジトリフィールドに由来し、対応する月次ランキングページへ戻るリンクを持ちます。ソース: GitStarClub リポジトリスター履歴。",
      "links": [
        {
          "label": "example/repo のスター履歴",
          "href": "https://gitstarclub.com/ja/example/repo"
        },
        {
          "label": "10k ランキング月",
          "href": "https://gitstarclub.com/ja/rankings/2020/3"
        },
        {
          "label": "50k ランキング月",
          "href": "https://gitstarclub.com/ja/rankings/2024/6"
        }
      ],
      "copyText": "2026-06-24 時点で、GitStarClub は example/repo が 2020年3月 に 10k、2024年6月 に 50k を超えたことを記録しています。これらのマイルストーン日は固定済みリポジトリフィールドに由来し、対応する月次ランキングページへ戻るリンクを持ちます。ソース: GitStarClub リポジトリスター履歴。\nexample/repo のスター履歴: https://gitstarclub.com/ja/example/repo\n10k ランキング月: https://gitstarclub.com/ja/rankings/2020/3\n50k ランキング月: https://gitstarclub.com/ja/rankings/2024/6",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/ja/example/repo\"><p><strong>example/repo のマイルストーン</strong></p><p>2026-06-24 時点で、GitStarClub は example/repo が 2020年3月 に 10k、2024年6月 に 50k を超えたことを記録しています。これらのマイルストーン日は固定済みリポジトリフィールドに由来し、対応する月次ランキングページへ戻るリンクを持ちます。ソース: GitStarClub リポジトリスター履歴。</p><p><a href=\"https://gitstarclub.com/ja/example/repo\">ソース: example/repo のスター履歴</a></p></blockquote>"
    },
    "org": {
      "kind": "org-total",
      "title": "example の組織合計",
      "text": "2026-06-24 時点で、example は GitStarClub 上の 1,234 件の追跡対象リポジトリ全体で合計 40万 GitHub スターを持ちます。 上位の追跡対象リポジトリには example/one（14万 スター）、example/two（4.4万 スター）、example/three（3.2万 スター） があります。ソース: GitStarClub 組織スター履歴。",
      "links": [
        {
          "label": "example のスター履歴",
          "href": "https://gitstarclub.com/ja/o/example"
        },
        {
          "label": "example/one",
          "href": "https://gitstarclub.com/ja/example/one"
        },
        {
          "label": "example/two",
          "href": "https://gitstarclub.com/ja/example/two"
        },
        {
          "label": "example/three",
          "href": "https://gitstarclub.com/ja/example/three"
        }
      ],
      "copyText": "2026-06-24 時点で、example は GitStarClub 上の 1,234 件の追跡対象リポジトリ全体で合計 40万 GitHub スターを持ちます。 上位の追跡対象リポジトリには example/one（14万 スター）、example/two（4.4万 スター）、example/three（3.2万 スター） があります。ソース: GitStarClub 組織スター履歴。\nexample のスター履歴: https://gitstarclub.com/ja/o/example\nexample/one: https://gitstarclub.com/ja/example/one\nexample/two: https://gitstarclub.com/ja/example/two\nexample/three: https://gitstarclub.com/ja/example/three",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/ja/o/example\"><p><strong>example の組織合計</strong></p><p>2026-06-24 時点で、example は GitStarClub 上の 1,234 件の追跡対象リポジトリ全体で合計 40万 GitHub スターを持ちます。 上位の追跡対象リポジトリには example/one（14万 スター）、example/two（4.4万 スター）、example/three（3.2万 スター） があります。ソース: GitStarClub 組織スター履歴。</p><p><a href=\"https://gitstarclub.com/ja/o/example\">ソース: example のスター履歴</a></p></blockquote>"
    }
  },
  "zh": {
    "repo": {
      "kind": "repo-milestones",
      "title": "example/repo 里程碑",
      "text": "截至 2026-06-24，GitStarClub 记录 example/repo 跨过了 2020年3月 达到 10k和2024年6月 达到 50k。这些里程碑日期来自固定的仓库字段，并链接回对应的月度排名页。来源：GitStarClub 仓库星标历史。",
      "links": [
        {
          "label": "example/repo 星标历史",
          "href": "https://gitstarclub.com/zh/example/repo"
        },
        {
          "label": "10k 排名月份",
          "href": "https://gitstarclub.com/zh/rankings/2020/3"
        },
        {
          "label": "50k 排名月份",
          "href": "https://gitstarclub.com/zh/rankings/2024/6"
        }
      ],
      "copyText": "截至 2026-06-24，GitStarClub 记录 example/repo 跨过了 2020年3月 达到 10k和2024年6月 达到 50k。这些里程碑日期来自固定的仓库字段，并链接回对应的月度排名页。来源：GitStarClub 仓库星标历史。\nexample/repo 星标历史: https://gitstarclub.com/zh/example/repo\n10k 排名月份: https://gitstarclub.com/zh/rankings/2020/3\n50k 排名月份: https://gitstarclub.com/zh/rankings/2024/6",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/zh/example/repo\"><p><strong>example/repo 里程碑</strong></p><p>截至 2026-06-24，GitStarClub 记录 example/repo 跨过了 2020年3月 达到 10k和2024年6月 达到 50k。这些里程碑日期来自固定的仓库字段，并链接回对应的月度排名页。来源：GitStarClub 仓库星标历史。</p><p><a href=\"https://gitstarclub.com/zh/example/repo\">来源: example/repo 星标历史</a></p></blockquote>"
    },
    "org": {
      "kind": "org-total",
      "title": "example 组织总量",
      "text": "截至 2026-06-24，example 在 GitStarClub 的 1,234 个已追踪仓库中共有 40万 个 GitHub 星标。 热门已追踪仓库包括 example/one（14万 星）、example/two（4.4万 星）和example/three（3.2万 星）。来源：GitStarClub 组织星标历史。",
      "links": [
        {
          "label": "example 星标历史",
          "href": "https://gitstarclub.com/zh/o/example"
        },
        {
          "label": "example/one",
          "href": "https://gitstarclub.com/zh/example/one"
        },
        {
          "label": "example/two",
          "href": "https://gitstarclub.com/zh/example/two"
        },
        {
          "label": "example/three",
          "href": "https://gitstarclub.com/zh/example/three"
        }
      ],
      "copyText": "截至 2026-06-24，example 在 GitStarClub 的 1,234 个已追踪仓库中共有 40万 个 GitHub 星标。 热门已追踪仓库包括 example/one（14万 星）、example/two（4.4万 星）和example/three（3.2万 星）。来源：GitStarClub 组织星标历史。\nexample 星标历史: https://gitstarclub.com/zh/o/example\nexample/one: https://gitstarclub.com/zh/example/one\nexample/two: https://gitstarclub.com/zh/example/two\nexample/three: https://gitstarclub.com/zh/example/three",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/zh/o/example\"><p><strong>example 组织总量</strong></p><p>截至 2026-06-24，example 在 GitStarClub 的 1,234 个已追踪仓库中共有 40万 个 GitHub 星标。 热门已追踪仓库包括 example/one（14万 星）、example/two（4.4万 星）和example/three（3.2万 星）。来源：GitStarClub 组织星标历史。</p><p><a href=\"https://gitstarclub.com/zh/o/example\">来源: example 星标历史</a></p></blockquote>"
    }
  },
  "zh-TW": {
    "repo": {
      "kind": "repo-milestones",
      "title": "example/repo 里程碑",
      "text": "截至 2026-06-24，GitStarClub 記錄 example/repo 跨過了 2020年3月 達到 10k和2024年6月 達到 50k。這些里程碑日期來自固定的倉庫欄位，並連結回對應的月度排名頁。來源：GitStarClub 倉庫星標歷史。",
      "links": [
        {
          "label": "example/repo 星標歷史",
          "href": "https://gitstarclub.com/zh-TW/example/repo"
        },
        {
          "label": "10k 排名月份",
          "href": "https://gitstarclub.com/zh-TW/rankings/2020/3"
        },
        {
          "label": "50k 排名月份",
          "href": "https://gitstarclub.com/zh-TW/rankings/2024/6"
        }
      ],
      "copyText": "截至 2026-06-24，GitStarClub 記錄 example/repo 跨過了 2020年3月 達到 10k和2024年6月 達到 50k。這些里程碑日期來自固定的倉庫欄位，並連結回對應的月度排名頁。來源：GitStarClub 倉庫星標歷史。\nexample/repo 星標歷史: https://gitstarclub.com/zh-TW/example/repo\n10k 排名月份: https://gitstarclub.com/zh-TW/rankings/2020/3\n50k 排名月份: https://gitstarclub.com/zh-TW/rankings/2024/6",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/zh-TW/example/repo\"><p><strong>example/repo 里程碑</strong></p><p>截至 2026-06-24，GitStarClub 記錄 example/repo 跨過了 2020年3月 達到 10k和2024年6月 達到 50k。這些里程碑日期來自固定的倉庫欄位，並連結回對應的月度排名頁。來源：GitStarClub 倉庫星標歷史。</p><p><a href=\"https://gitstarclub.com/zh-TW/example/repo\">來源: example/repo 星標歷史</a></p></blockquote>"
    },
    "org": {
      "kind": "org-total",
      "title": "example 組織總量",
      "text": "截至 2026-06-24，example 在 GitStarClub 的 1,234 個已追蹤倉庫中共有 40萬 個 GitHub 星標。 熱門已追蹤倉庫包括 example/one（14萬 星）、example/two（4.4萬 星）和example/three（3.2萬 星）。來源：GitStarClub 組織星標歷史。",
      "links": [
        {
          "label": "example 星標歷史",
          "href": "https://gitstarclub.com/zh-TW/o/example"
        },
        {
          "label": "example/one",
          "href": "https://gitstarclub.com/zh-TW/example/one"
        },
        {
          "label": "example/two",
          "href": "https://gitstarclub.com/zh-TW/example/two"
        },
        {
          "label": "example/three",
          "href": "https://gitstarclub.com/zh-TW/example/three"
        }
      ],
      "copyText": "截至 2026-06-24，example 在 GitStarClub 的 1,234 個已追蹤倉庫中共有 40萬 個 GitHub 星標。 熱門已追蹤倉庫包括 example/one（14萬 星）、example/two（4.4萬 星）和example/three（3.2萬 星）。來源：GitStarClub 組織星標歷史。\nexample 星標歷史: https://gitstarclub.com/zh-TW/o/example\nexample/one: https://gitstarclub.com/zh-TW/example/one\nexample/two: https://gitstarclub.com/zh-TW/example/two\nexample/three: https://gitstarclub.com/zh-TW/example/three",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/zh-TW/o/example\"><p><strong>example 組織總量</strong></p><p>截至 2026-06-24，example 在 GitStarClub 的 1,234 個已追蹤倉庫中共有 40萬 個 GitHub 星標。 熱門已追蹤倉庫包括 example/one（14萬 星）、example/two（4.4萬 星）和example/three（3.2萬 星）。來源：GitStarClub 組織星標歷史。</p><p><a href=\"https://gitstarclub.com/zh-TW/o/example\">來源: example 星標歷史</a></p></blockquote>"
    }
  },
  "ko": {
    "repo": {
      "kind": "repo-milestones",
      "title": "example/repo 이정표",
      "text": "2026-06-24 기준으로 GitStarClub은 example/repo가 2020년 3월에 10k 및 2024년 6월에 50k을(를) 넘었다고 기록합니다. 이 이정표 날짜는 고정된 저장소 필드에서 오며 해당 월간 순위 페이지로 다시 연결됩니다. 출처: GitStarClub 저장소 스타 히스토리.",
      "links": [
        {
          "label": "example/repo 스타 히스토리",
          "href": "https://gitstarclub.com/ko/example/repo"
        },
        {
          "label": "10k 순위 월",
          "href": "https://gitstarclub.com/ko/rankings/2020/3"
        },
        {
          "label": "50k 순위 월",
          "href": "https://gitstarclub.com/ko/rankings/2024/6"
        }
      ],
      "copyText": "2026-06-24 기준으로 GitStarClub은 example/repo가 2020년 3월에 10k 및 2024년 6월에 50k을(를) 넘었다고 기록합니다. 이 이정표 날짜는 고정된 저장소 필드에서 오며 해당 월간 순위 페이지로 다시 연결됩니다. 출처: GitStarClub 저장소 스타 히스토리.\nexample/repo 스타 히스토리: https://gitstarclub.com/ko/example/repo\n10k 순위 월: https://gitstarclub.com/ko/rankings/2020/3\n50k 순위 월: https://gitstarclub.com/ko/rankings/2024/6",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/ko/example/repo\"><p><strong>example/repo 이정표</strong></p><p>2026-06-24 기준으로 GitStarClub은 example/repo가 2020년 3월에 10k 및 2024년 6월에 50k을(를) 넘었다고 기록합니다. 이 이정표 날짜는 고정된 저장소 필드에서 오며 해당 월간 순위 페이지로 다시 연결됩니다. 출처: GitStarClub 저장소 스타 히스토리.</p><p><a href=\"https://gitstarclub.com/ko/example/repo\">출처: example/repo 스타 히스토리</a></p></blockquote>"
    },
    "org": {
      "kind": "org-total",
      "title": "example 조직 합계",
      "text": "2026-06-24 기준으로 example은 GitStarClub의 추적 저장소 1,234개에서 총 GitHub 스타 40만개를 가지고 있습니다.  상위 추적 저장소에는 example/one(14만 스타), example/two(4.4만 스타) 및 example/three(3.2만 스타)이(가) 있습니다.출처: GitStarClub 조직 스타 히스토리.",
      "links": [
        {
          "label": "example 스타 히스토리",
          "href": "https://gitstarclub.com/ko/o/example"
        },
        {
          "label": "example/one",
          "href": "https://gitstarclub.com/ko/example/one"
        },
        {
          "label": "example/two",
          "href": "https://gitstarclub.com/ko/example/two"
        },
        {
          "label": "example/three",
          "href": "https://gitstarclub.com/ko/example/three"
        }
      ],
      "copyText": "2026-06-24 기준으로 example은 GitStarClub의 추적 저장소 1,234개에서 총 GitHub 스타 40만개를 가지고 있습니다.  상위 추적 저장소에는 example/one(14만 스타), example/two(4.4만 스타) 및 example/three(3.2만 스타)이(가) 있습니다.출처: GitStarClub 조직 스타 히스토리.\nexample 스타 히스토리: https://gitstarclub.com/ko/o/example\nexample/one: https://gitstarclub.com/ko/example/one\nexample/two: https://gitstarclub.com/ko/example/two\nexample/three: https://gitstarclub.com/ko/example/three",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/ko/o/example\"><p><strong>example 조직 합계</strong></p><p>2026-06-24 기준으로 example은 GitStarClub의 추적 저장소 1,234개에서 총 GitHub 스타 40만개를 가지고 있습니다.  상위 추적 저장소에는 example/one(14만 스타), example/two(4.4만 스타) 및 example/three(3.2만 스타)이(가) 있습니다.출처: GitStarClub 조직 스타 히스토리.</p><p><a href=\"https://gitstarclub.com/ko/o/example\">출처: example 스타 히스토리</a></p></blockquote>"
    }
  },
  "es": {
    "repo": {
      "kind": "repo-milestones",
      "title": "Hitos de example/repo",
      "text": "Al 2026-06-24, GitStarClub registra que example/repo cruzó 10k en marzo de 2020 y 50k en junio de 2024. Estas fechas de hitos provienen de campos congelados de repositorio y enlazan a las páginas de ranking mensual correspondientes. Fuente: historial de estrellas de repositorio de GitStarClub.",
      "links": [
        {
          "label": "Historial de estrellas de example/repo",
          "href": "https://gitstarclub.com/es/example/repo"
        },
        {
          "label": "Mes de ranking de 10k",
          "href": "https://gitstarclub.com/es/rankings/2020/3"
        },
        {
          "label": "Mes de ranking de 50k",
          "href": "https://gitstarclub.com/es/rankings/2024/6"
        }
      ],
      "copyText": "Al 2026-06-24, GitStarClub registra que example/repo cruzó 10k en marzo de 2020 y 50k en junio de 2024. Estas fechas de hitos provienen de campos congelados de repositorio y enlazan a las páginas de ranking mensual correspondientes. Fuente: historial de estrellas de repositorio de GitStarClub.\nHistorial de estrellas de example/repo: https://gitstarclub.com/es/example/repo\nMes de ranking de 10k: https://gitstarclub.com/es/rankings/2020/3\nMes de ranking de 50k: https://gitstarclub.com/es/rankings/2024/6",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/es/example/repo\"><p><strong>Hitos de example/repo</strong></p><p>Al 2026-06-24, GitStarClub registra que example/repo cruzó 10k en marzo de 2020 y 50k en junio de 2024. Estas fechas de hitos provienen de campos congelados de repositorio y enlazan a las páginas de ranking mensual correspondientes. Fuente: historial de estrellas de repositorio de GitStarClub.</p><p><a href=\"https://gitstarclub.com/es/example/repo\">Fuente: Historial de estrellas de example/repo</a></p></blockquote>"
    },
    "org": {
      "kind": "org-total",
      "title": "Total de organización de example",
      "text": "Al 2026-06-24, example tiene 400 mil estrellas totales de GitHub en 1234 repositorios monitoreados en GitStarClub. Los repositorios monitoreados principales incluyen example/one (140 mil estrellas), example/two (44 mil estrellas) y example/three (32 mil estrellas). Fuente: historial de estrellas de organización de GitStarClub.",
      "links": [
        {
          "label": "Historial de estrellas de example",
          "href": "https://gitstarclub.com/es/o/example"
        },
        {
          "label": "example/one",
          "href": "https://gitstarclub.com/es/example/one"
        },
        {
          "label": "example/two",
          "href": "https://gitstarclub.com/es/example/two"
        },
        {
          "label": "example/three",
          "href": "https://gitstarclub.com/es/example/three"
        }
      ],
      "copyText": "Al 2026-06-24, example tiene 400 mil estrellas totales de GitHub en 1234 repositorios monitoreados en GitStarClub. Los repositorios monitoreados principales incluyen example/one (140 mil estrellas), example/two (44 mil estrellas) y example/three (32 mil estrellas). Fuente: historial de estrellas de organización de GitStarClub.\nHistorial de estrellas de example: https://gitstarclub.com/es/o/example\nexample/one: https://gitstarclub.com/es/example/one\nexample/two: https://gitstarclub.com/es/example/two\nexample/three: https://gitstarclub.com/es/example/three",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/es/o/example\"><p><strong>Total de organización de example</strong></p><p>Al 2026-06-24, example tiene 400 mil estrellas totales de GitHub en 1234 repositorios monitoreados en GitStarClub. Los repositorios monitoreados principales incluyen example/one (140 mil estrellas), example/two (44 mil estrellas) y example/three (32 mil estrellas). Fuente: historial de estrellas de organización de GitStarClub.</p><p><a href=\"https://gitstarclub.com/es/o/example\">Fuente: Historial de estrellas de example</a></p></blockquote>"
    }
  },
  "fr": {
    "repo": {
      "kind": "repo-milestones",
      "title": "Jalons de example/repo",
      "text": "Au 2026-06-24, GitStarClub indique que example/repo a franchi 10k en mars 2020 et 50k en juin 2024. Ces dates de jalons proviennent de champs de dépôt figés et renvoient aux pages de classement mensuel correspondantes. Source : historique des étoiles de dépôt GitStarClub.",
      "links": [
        {
          "label": "Historique des étoiles de example/repo",
          "href": "https://gitstarclub.com/fr/example/repo"
        },
        {
          "label": "Mois de classement 10k",
          "href": "https://gitstarclub.com/fr/rankings/2020/3"
        },
        {
          "label": "Mois de classement 50k",
          "href": "https://gitstarclub.com/fr/rankings/2024/6"
        }
      ],
      "copyText": "Au 2026-06-24, GitStarClub indique que example/repo a franchi 10k en mars 2020 et 50k en juin 2024. Ces dates de jalons proviennent de champs de dépôt figés et renvoient aux pages de classement mensuel correspondantes. Source : historique des étoiles de dépôt GitStarClub.\nHistorique des étoiles de example/repo: https://gitstarclub.com/fr/example/repo\nMois de classement 10k: https://gitstarclub.com/fr/rankings/2020/3\nMois de classement 50k: https://gitstarclub.com/fr/rankings/2024/6",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/fr/example/repo\"><p><strong>Jalons de example/repo</strong></p><p>Au 2026-06-24, GitStarClub indique que example/repo a franchi 10k en mars 2020 et 50k en juin 2024. Ces dates de jalons proviennent de champs de dépôt figés et renvoient aux pages de classement mensuel correspondantes. Source : historique des étoiles de dépôt GitStarClub.</p><p><a href=\"https://gitstarclub.com/fr/example/repo\">Source: Historique des étoiles de example/repo</a></p></blockquote>"
    },
    "org": {
      "kind": "org-total",
      "title": "Total d'organisation example",
      "text": "Au 2026-06-24, example compte 400 k étoiles GitHub totales sur 1 234 dépôts suivis dans GitStarClub. Les principaux dépôts suivis incluent example/one (140 k étoiles), example/two (44 k étoiles) et example/three (32 k étoiles). Source : historique des étoiles d'organisation GitStarClub.",
      "links": [
        {
          "label": "Historique des étoiles de example",
          "href": "https://gitstarclub.com/fr/o/example"
        },
        {
          "label": "example/one",
          "href": "https://gitstarclub.com/fr/example/one"
        },
        {
          "label": "example/two",
          "href": "https://gitstarclub.com/fr/example/two"
        },
        {
          "label": "example/three",
          "href": "https://gitstarclub.com/fr/example/three"
        }
      ],
      "copyText": "Au 2026-06-24, example compte 400 k étoiles GitHub totales sur 1 234 dépôts suivis dans GitStarClub. Les principaux dépôts suivis incluent example/one (140 k étoiles), example/two (44 k étoiles) et example/three (32 k étoiles). Source : historique des étoiles d'organisation GitStarClub.\nHistorique des étoiles de example: https://gitstarclub.com/fr/o/example\nexample/one: https://gitstarclub.com/fr/example/one\nexample/two: https://gitstarclub.com/fr/example/two\nexample/three: https://gitstarclub.com/fr/example/three",
      "embedHtml": "<blockquote cite=\"https://gitstarclub.com/fr/o/example\"><p><strong>Total d'organisation example</strong></p><p>Au 2026-06-24, example compte 400 k étoiles GitHub totales sur 1 234 dépôts suivis dans GitStarClub. Les principaux dépôts suivis incluent example/one (140 k étoiles), example/two (44 k étoiles) et example/three (32 k étoiles). Source : historique des étoiles d'organisation GitStarClub.</p><p><a href=\"https://gitstarclub.com/fr/o/example\">Source: Historique des étoiles de example</a></p></blockquote>"
    }
  }
};

describe("live localized snippet fixtures", () => {
  for (const locale of Object.keys(localizedFixtures) as Locale[]) {
    test(`${locale}: repository copy, embed, and canonical URLs match the baseline`, async () => {
      const t = await getDictionary(locale);
      expect(buildLocalizedRepoMilestoneSnippet({
        t, locale, repo: { full_name: "example/repo" }, asOf: "2026-06-24",
        milestones: [
          { label: "10k", stars: 10000, date: "2020-03-15", monthIndex: 0 },
          { label: "50k", stars: 50000, date: "2024-06-01", monthIndex: 1 },
        ],
      })).toEqual(localizedFixtures[locale].repo);
    });

    test(`${locale}: organization copy, embed, and canonical URLs match the baseline`, async () => {
      const t = await getDictionary(locale);
      expect(buildLocalizedOrgTotalSnippet({
        t, locale, org: { login: "example", current_stars_sum: 400000, repo_count: 1234 },
        asOf: "2026-06-24",
        members: [
          { owner: "example", name: "one", total: 140000, lang: null },
          { owner: "example", name: "two", total: 44000, lang: null },
          { owner: "example", name: "three", total: 32000, lang: null },
          { owner: "example", name: "four", total: 0, lang: null },
        ],
      })).toEqual(localizedFixtures[locale].org);
    });

    test(`${locale}: empty milestones and missing publication dates suppress snippets`, async () => {
      const t = await getDictionary(locale);
      const args = { t, locale, repo: { full_name: "example/repo" }, asOf: "2026-06-24", milestones: [] };
      expect(buildLocalizedRepoMilestoneSnippet(args)).toBeNull();
      expect(buildLocalizedRepoMilestoneSnippet({ ...args, asOf: null, milestones: [
        { label: "10k", stars: 10000, date: "2020-03-15", monthIndex: 0 },
      ] })).toBeNull();
      expect(buildLocalizedOrgTotalSnippet({ t, locale, org: { login: "example", current_stars_sum: 0, repo_count: 0 }, asOf: null, members: [] })).toBeNull();
    });
  }

  test("live repository snippet omits unroutable pre-2015 milestone links", async () => {
    const t = await getDictionary("en");
    const snippet = buildLocalizedRepoMilestoneSnippet({
      t, locale: "en", repo: { full_name: "example/repo" }, asOf,
      milestones: [{ stars: 10000, label: "10k", date: "2014-02-01", monthIndex: 0 }],
    });
    expect(snippet?.text).toContain("10k in February 2014");
    expect(snippet?.links).toEqual([{ label: "example/repo star history", href: "https://gitstarclub.com/example/repo" }]);
  });

  test("empty organization members keep the dated total without a leader sentence", async () => {
    const t = await getDictionary("en");
    expect(buildLocalizedOrgTotalSnippet({
      t, locale: "en", org: { login: "empty", current_stars_sum: 0, repo_count: 0 }, asOf, members: [],
    })?.copyText).toBe("As of June 24, 2026, empty has 0 total GitHub stars across 0 tracked repositories on GitStarClub. Source: GitStarClub organization star history.\nempty star history: https://gitstarclub.com/o/empty");
  });
});

describe("shared serialization and formatting boundaries", () => {
  test("escapes HTML and attributes while copied text stays literal", () => {
    const input = { kind: "org-total" as const, title: '<img src="x"> & title', text: 'A <script> & "quoted" text',
      links: [{ label: '<source> & "name"', href: '/o/example?x="a"&y=<b>' }], sourceLabel: '<label> & "source"' };
    const snippet = buildShareableSnippet(input);
    expect(snippet.copyText).toBe('A <script> & "quoted" text\n<source> & "name": https://gitstarclub.com/o/example?x="a"&y=<b>');
    expect(snippet.embedHtml).toBe('<blockquote cite="https://gitstarclub.com/o/example?x=&quot;a&quot;&amp;y=&lt;b&gt;"><p><strong>&lt;img src="x"&gt; &amp; title</strong></p><p>A &lt;script&gt; &amp; "quoted" text</p><p><a href="https://gitstarclub.com/o/example?x=&quot;a&quot;&amp;y=&lt;b&gt;">&lt;label&gt; &amp; "source": &lt;source&gt; &amp; "name"</a></p></blockquote>');
    expect(input.links[0].href).toBe('/o/example?x="a"&y=<b>');
  });

  test("linkless embeds cite the canonical root and omit the source paragraph", () => {
    const snippet = buildShareableSnippet({kind: "repo-milestones",title:"T",text:"Text",links:[]});
    expect(snippet.copyText).toBe("Text");
    expect(snippet.embedHtml).toBe('<blockquote cite="https://gitstarclub.com/"><p><strong>T</strong></p><p>Text</p></blockquote>');
  });

  test("placeholder formatting preserves zero, empty values, and unknown tokens", () => {
    expect(formatTemplate("{zero}|{blank}|{negative}|{missing}|{nil}|{later}|{hyphen-key}", {
      zero: 0, blank: "", negative: -2, nil: null, later: undefined,
    })).toBe("0||-2|{missing}|{nil}|{later}|{hyphen-key}");
    expect(formatTemplate("{value} {value}", {value: "$& <literal>"})).toBe("$& <literal> $& <literal>");
  });

  test("signed compact stars preserve positive, zero, and negative values", () => {
    expect([1200,0,-1200,-0].map(n=>formatSignedStars(n,"en"))).toEqual(["+1.2k","+0","-1.2k","+0"]);
    expect(formatSignedStars(-1200,"fr")).toBe("-1,2 k");
  });

  test("conjunction formatting accepts readonly items, language tags, and empty lists", () => {
    const values = ["one","two","three"] as const;
    expect(formatConjunction("en",values)).toBe("one, two, and three");
    expect(formatConjunction("fr-FR",values)).toBe("one, two et three");
    expect(formatConjunction("en",[])).toBe("");
    expect(formatConjunction("en",["one"])).toBe("one");
    expect(values).toEqual(["one","two","three"]);
  });
});
