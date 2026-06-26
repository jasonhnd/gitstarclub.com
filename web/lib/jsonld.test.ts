import { describe, expect, test } from "bun:test";
import { faqPageLd, itemListLd, repoLd } from "./jsonld";
import { stringifyJsonForScript } from "./json-script";

describe("repoLd", () => {
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
