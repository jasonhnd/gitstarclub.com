import { describe, expect, test } from "bun:test";
import { SITE_ORGANIZATION_SAME_AS, collectionLd, datasetLd, datasetRef, faqPageLd, itemListLd, orgLd, repoLd, siteOrganizationLd } from "./jsonld";
import { stringifyJsonForScript } from "./json-script";
import { resolveDataAsOfValue } from "./geo-capsules";

describe("repoLd", () => {
  test("emits a sameAs array with the GitHub repo and deterministic homepage metadata", () => {
    const data = repoLd(
      {
        full_name: "owner/tool",
        language: "TypeScript",
        languages: [{ name: "TypeScript", size: 100, color: "#3178c6" }],
        description: "A useful developer tool.",
        homepage_url: "https://tool.example",
        created_at: "2024-01-02",
        current_stars: 12345,
      },
      "/owner/tool",
      "en",
    );

    expect(data).toMatchObject({
      "@type": "SoftwareSourceCode",
      codeRepository: "https://github.com/owner/tool",
      sameAs: ["https://github.com/owner/tool", "https://tool.example"],
    });
  });

  test("emits only the GitHub URL when homepage metadata is absent", () => {
    const data = repoLd(
      {
        full_name: "owner/tool",
        language: "TypeScript",
        languages: [{ name: "TypeScript", size: 100, color: "#3178c6" }],
        description: "A useful developer tool.",
        created_at: "2024-01-02",
        current_stars: 12345,
      },
      "/owner/tool",
      "en",
    );

    expect(data.sameAs).toEqual(["https://github.com/owner/tool"]);
  });

  test("drops non-https and malformed homepage metadata from sameAs", () => {
    for (const homepage_url of ["http://tool.example", "not a url"]) {
      const data = repoLd(
        {
          full_name: "owner/tool",
          language: "TypeScript",
          languages: [{ name: "TypeScript", size: 100, color: "#3178c6" }],
          description: "A useful developer tool.",
          homepage_url,
          created_at: "2024-01-02",
          current_stars: 12345,
        },
        "/owner/tool",
        "en",
      );

      expect(data.sameAs).toEqual(["https://github.com/owner/tool"]);
    }
  });

  test("deduplicates homepage metadata when it matches the GitHub URL", () => {
    const data = repoLd(
      {
        full_name: "owner/tool",
        language: "TypeScript",
        languages: [{ name: "TypeScript", size: 100, color: "#3178c6" }],
        description: "A useful developer tool.",
        homepage_url: "https://github.com/owner/tool",
        created_at: "2024-01-02",
        current_stars: 12345,
      },
      "/owner/tool",
      "en",
    );

    expect(data.sameAs).toEqual(["https://github.com/owner/tool"]);
  });

  test("can be safely serialized into a JSON-LD script with adversarial text", () => {
    const data = repoLd(
      {
        full_name: "owner/tool",
        language: "TypeScript",
        languages: [{ name: "TypeScript", size: 100, color: "#3178c6" }],
        description: 'x</script><img src=x onerror="alert(1)">',
        created_at: "2024-01-02",
        current_stars: 12345,
      },
      "/owner/tool",
      "en",
    );

    const serialized = stringifyJsonForScript(data);

    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<img");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(serialized)).toMatchObject({
      "@type": "SoftwareSourceCode",
      name: "owner/tool",
      description: 'x</script><img src=x onerror="alert(1)">',
    });
  });
});

describe("orgLd", () => {
  test("emits an Organization sameAs array with the mandatory GitHub owner URL", () => {
    const data = orgLd({ login: "vercel", owner_type: "Organization" }, "/o/vercel", "en");

    expect(data).toMatchObject({
      "@type": "Organization",
      name: "vercel",
      url: "https://gitstarclub.com/o/vercel",
      sameAs: ["https://github.com/vercel"],
      inLanguage: "en",
    });
  });

  test("emits a Person sameAs array for GitHub user owners", () => {
    const data = orgLd({ login: "tj", owner_type: "User" }, "/o/tj", "en");

    expect(data).toMatchObject({
      "@type": "Person",
      name: "tj",
      sameAs: ["https://github.com/tj"],
    });
  });
});

describe("siteOrganizationLd", () => {
  test("emits the reviewed site-level Organization identity", () => {
    const data = siteOrganizationLd();

    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "GitStarClub",
      url: "https://gitstarclub.com",
      logo: "https://gitstarclub.com/icon-512.png",
      sameAs: [...SITE_ORGANIZATION_SAME_AS],
    });
    expect(data.sameAs).toEqual(["https://github.com/jasonhnd/gitstarclub.com"]);
  });
});

describe("itemListLd", () => {
  test("emits stable ItemList positions and absolute item URLs", () => {
    const data = itemListLd("Top repos", "/rankings", "en", [{ name: "vuejs/vue", path: "/vuejs/vue" }], 11);

    expect(data).toMatchObject({
      "@type": "ItemList",
      name: "Top repos",
      numberOfItems: 1,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 11,
          item: {
            name: "vuejs/vue",
            url: "https://gitstarclub.com/vuejs/vue",
          },
        },
      ],
    });
  });
});

describe("datasetLd", () => {
  test("emits reusable Dataset JSON-LD with a real dateModified value", () => {
    const dateModified = resolveDataAsOfValue("fallback", "2026-06-24T12:00:00Z");
    const data = datasetLd({
      name: "GitStarClub June 2026 Rankings Dataset",
      path: "/rankings/2026/6",
      locale: "en",
      description: "Monthly GitHub repository rankings generated from precomputed Blob rank and heatmap JSON.",
      dateModified,
      variableMeasured: ["rank item value (flow stars added)", "current_stars"],
    });

    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Dataset",
      "@id": "https://gitstarclub.com/rankings/2026/6#dataset",
      name: "GitStarClub June 2026 Rankings Dataset",
      url: "https://gitstarclub.com/rankings/2026/6",
      inLanguage: "en",
      isAccessibleForFree: true,
      license: "https://creativecommons.org/licenses/by/4.0/",
      dateModified: "2026-06-24T12:00:00Z",
      creator: {
        "@type": "Organization",
        name: "GitStarClub",
        url: "https://gitstarclub.com",
      },
      variableMeasured: [
        { "@type": "PropertyValue", name: "rank item value (flow stars added)" },
        { "@type": "PropertyValue", name: "current_stars" },
      ],
    });
  });

  test("serializes dateModified and omits fallback-only dates", () => {
    const dataset = datasetLd({
      name: "GitStarClub Categories Dataset",
      path: "/categories",
      locale: "en",
      description: "Category registry and repository assignment data generated from precomputed Blob JSON.",
      dateModified: resolveDataAsOfValue("fallback"),
    });
    const collection = collectionLd("GitHub repository categories", "/categories", "en", {
      dateModified: resolveDataAsOfValue("fallback", "2026-06-25T00:00:00Z"),
      about: datasetRef("/categories"),
    });

    expect(dataset).not.toHaveProperty("dateModified");
    expect(JSON.parse(stringifyJsonForScript(collection))).toMatchObject({
      "@type": "CollectionPage",
      dateModified: "2026-06-25T00:00:00Z",
      about: { "@id": "https://gitstarclub.com/categories#dataset" },
    });
  });
});

describe("faqPageLd", () => {
  test("emits FAQPage schema with Question and Answer entities", () => {
    const data = faqPageLd(
      [
        {
          question: "What does GitStarClub track?",
          answer: "GitStarClub tracks precomputed GitHub star history.",
        },
      ],
      "/rankings",
      "en",
    );

    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      url: "https://gitstarclub.com/rankings",
      inLanguage: "en",
      mainEntity: [
        {
          "@type": "Question",
          name: "What does GitStarClub track?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "GitStarClub tracks precomputed GitHub star history.",
          },
        },
      ],
    });
  });

  test("can be safely serialized into a JSON-LD script with adversarial FAQ text", () => {
    const data = faqPageLd(
      [
        {
          question: 'Can FAQ text contain "</script>"?',
          answer: 'No raw x</script><img src=x onerror="alert(1)"> markup should survive script serialization.',
        },
      ],
      "/faq-test",
      "en",
    );

    const serialized = stringifyJsonForScript(data);

    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<img");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(serialized)).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [
        {
          name: 'Can FAQ text contain "</script>"?',
          acceptedAnswer: {
            text: 'No raw x</script><img src=x onerror="alert(1)"> markup should survive script serialization.',
          },
        },
      ],
    });
  });
});
