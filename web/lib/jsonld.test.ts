import { describe, expect, test } from "bun:test";
import { repoLd } from "./jsonld";
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
