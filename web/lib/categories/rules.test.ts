import { describe, expect, test } from "bun:test";
import {
  classifyRepository,
  languageCategoryFromLanguage,
  languageFamilyForLanguageSlug,
  slugifyCategoryPart,
} from "./rules";

describe("category slug and language normalization", () => {
  test("normalizes common GitHub language names to stable slugs", () => {
    expect(slugifyCategoryPart("Python")).toBe("python");
    expect(slugifyCategoryPart("JavaScript")).toBe("javascript");
    expect(slugifyCategoryPart("C++")).toBe("cpp");
    expect(slugifyCategoryPart("C#")).toBe("csharp");
    expect(slugifyCategoryPart("Objective-C")).toBe("objective-c");
  });

  test("languageCategoryFromLanguage returns unknown only when source is missing", () => {
    expect(languageCategoryFromLanguage("Rust")).toEqual({ id: "language/rust", slug: "rust", label: "Rust" });
    expect(languageCategoryFromLanguage(null)).toEqual({ id: "language/unknown", slug: "unknown", label: "Unknown" });
  });

  test("languageFamilyForLanguageSlug maps priority languages", () => {
    expect(languageFamilyForLanguageSlug("javascript")).toBe("js-ts");
    expect(languageFamilyForLanguageSlug("typescript")).toBe("js-ts");
    expect(languageFamilyForLanguageSlug("html")).toBe("web-markup");
    expect(languageFamilyForLanguageSlug("go")).toBe("systems");
    expect(languageFamilyForLanguageSlug("rust")).toBe("systems");
    expect(languageFamilyForLanguageSlug("elixir")).toBe("other");
  });
});

describe("classifyRepository", () => {
  test("classifies Python AI library repos across dimensions", () => {
    const assignment = classifyRepository(
      {
        owner_type: "Organization",
        full_name: "acme/torch-tools",
        name: "torch-tools",
        description: "Machine learning library for PyTorch workflows",
        language: "Python",
        topics: ["machine-learning", "library", "python"],
        current_stars: 120_000,
        is_archived: false,
        crossed_10k: "2026-02-01",
      },
      { generatedAt: "2026-06-05T00:00:00Z" },
    );

    expect(assignment.language).toEqual(["language/python"]);
    expect(assignment.language_family).toEqual(["language_family/python"]);
    expect(assignment.domain).toContain("domain/ai-ml");
    expect(assignment.project_type).toContain("project_type/library");
    expect(assignment.ecosystem).toContain("ecosystem/python");
    expect(assignment.owner_kind).toEqual(["owner_kind/organization"]);
    expect(assignment.maturity).toEqual([
      "maturity/star-10k",
      "maturity/star-50k",
      "maturity/star-100k",
      "maturity/newcomer-10k",
      "maturity/active",
    ]);
  });

  test("classifies HTML and frontend repos without backend false positives", () => {
    const assignment = classifyRepository({
      owner_type: "User",
      full_name: "web/ui-kit",
      name: "ui-kit",
      description: "Frontend design system",
      language: "HTML",
      topics: ["frontend", "design-system"],
      current_stars: 15_000,
      is_archived: false,
    });

    expect(assignment.language).toEqual(["language/html"]);
    expect(assignment.language_family).toEqual(["language_family/web-markup"]);
    expect(assignment.domain).toContain("domain/web-frontend");
    expect(assignment.domain).toContain("domain/design");
    expect(assignment.domain).not.toContain("domain/web-backend");
    expect(assignment.owner_kind).toEqual(["owner_kind/user"]);
  });

  test("classifies archived Go infrastructure tools", () => {
    const assignment = classifyRepository({
      owner_type: "Organization",
      full_name: "ops/kube-tool",
      name: "kube-tool",
      description: "Kubernetes command line automation tool",
      language: "Go",
      topics: ["kubernetes", "cli", "automation"],
      current_stars: 60_000,
      is_archived: true,
    });

    expect(assignment.language).toEqual(["language/go"]);
    expect(assignment.language_family).toEqual(["language_family/systems"]);
    expect(assignment.domain).toContain("domain/infra-cloud");
    expect(assignment.domain).toContain("domain/automation");
    expect(assignment.project_type).toContain("project_type/cli");
    expect(assignment.ecosystem).toContain("ecosystem/go");
    expect(assignment.ecosystem).toContain("ecosystem/docker-kubernetes");
    expect(assignment.maturity).toContain("maturity/archived");
  });
});
