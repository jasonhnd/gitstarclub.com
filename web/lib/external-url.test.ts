import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { safeExternalHref } from "./external-url";

describe("safeExternalHref", () => {
  test("accepts http and https links", () => {
    expect(safeExternalHref("http://example.com")).toBe("http://example.com");
    expect(safeExternalHref("https://example.com/releases/tag/v1")).toBe("https://example.com/releases/tag/v1");
  });

  test("rejects non-web protocols and malformed URLs", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,<h1>x</h1>", "file:///etc/passwd", "ftp://example.com/file", "not a url", "", null, undefined]) {
      expect(safeExternalHref(value)).toBeNull();
    }
  });

  test("neutralizes unsafe hrefs at render time", () => {
    function ExternalLink({ href }: { href: string }) {
      const safeHref = safeExternalHref(href);
      return safeHref ? createElement("a", { href: safeHref }, "release") : createElement("span", null, "release");
    }

    expect(renderToStaticMarkup(createElement(ExternalLink, { href: "javascript:alert(1)" }))).toBe("<span>release</span>");
    expect(renderToStaticMarkup(createElement(ExternalLink, { href: "https://github.com/owner/repo/releases/tag/v1" }))).toBe(
      '<a href="https://github.com/owner/repo/releases/tag/v1">release</a>',
    );
  });
});
