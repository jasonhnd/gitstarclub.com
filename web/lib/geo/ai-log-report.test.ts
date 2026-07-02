import { describe, expect, test } from "bun:test";
import { buildAiLogReport, formatAiLogReportMarkdown } from "./ai-log-report";

describe("AI crawler and referrer log report", () => {
  test("aggregates Vercel Log Drain proxy records without raw referrer query strings", () => {
    const input = JSON.stringify([
      {
        timestamp: 1_735_689_600_000,
        source: "static",
        proxy: {
          path: "/react/react?utm_source=secret",
          userAgent: ["Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"],
          statusCode: 200,
          clientIp: "192.0.2.10",
        },
      },
      {
        timestamp: 1_735_689_600_000,
        source: "lambda",
        proxy: {
          path: "/rankings/2026/6?debug=1",
          userAgent: ["ChatGPT-User/1.0"],
          referer: "https://chatgpt.com/c/private-thread?prompt=secret",
          statusCode: 304,
          clientIp: "192.0.2.11",
        },
      },
      {
        timestamp: 1_735_689_600_000,
        source: "static",
        proxy: {
          path: "/o/vercel",
          userAgent: ["Mozilla/5.0"],
          referer: "https://www.perplexity.ai/search?q=secret",
          statusCode: 200,
        },
      },
    ]);

    const report = buildAiLogReport(input);
    expect(report.crawler_counts).toEqual([
      {
        date: "2025-01-01",
        user_agent_family: "ChatGPT-User",
        path_family: "rankings",
        status_bucket: "3xx",
        count: 1,
      },
      {
        date: "2025-01-01",
        user_agent_family: "GPTBot",
        path_family: "repo",
        status_bucket: "2xx",
        count: 1,
      },
    ]);
    expect(report.referrer_counts).toEqual([
      {
        date: "2025-01-01",
        referrer_host: "chatgpt.com",
        path_family: "rankings",
        count: 1,
      },
      {
        date: "2025-01-01",
        referrer_host: "perplexity.ai",
        path_family: "org",
        count: 1,
      },
    ]);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("192.0.2");
  });

  test("accepts NDJSON request-log exports and weekly grain", () => {
    const input = [
      JSON.stringify({
        timestamp: "2026-01-01T12:00:00.000Z",
        requestPath: "/categories/language/python?page=2",
        requestUserAgent: "Claude-SearchBot/1.0",
        requestReferrer: "https://claude.ai/chat/abc?raw=secret",
        statusCode: 200,
      }),
      JSON.stringify({
        timestamp: "2026-01-03T12:00:00.000Z",
        request_path: "/compare?repos=secret",
        user_agent: "Mozilla/5.0 Applebot/0.1",
        referrer: "https://grok.com/share/abc",
        status_code: "404",
      }),
      "not json",
      JSON.stringify({
        timestamp: "2026-01-04T12:00:00.000Z",
        path: "/pulse",
        userAgent: "Mozilla/5.0",
        referer: "https://www.google.com/search?udm=50&q=gitstarclub",
        statusCode: 200,
      }),
    ].join("\n");

    const report = buildAiLogReport(input, { grain: "week" });

    expect(report.skipped_records).toBe(1);
    expect(report.crawler_counts).toEqual([
      {
        date: "2026-W01",
        user_agent_family: "Applebot",
        path_family: "compare",
        status_bucket: "4xx",
        count: 1,
      },
      {
        date: "2026-W01",
        user_agent_family: "Claude-SearchBot",
        path_family: "category",
        status_bucket: "2xx",
        count: 1,
      },
    ]);
    expect(report.referrer_counts).toEqual([
      {
        date: "2026-W01",
        referrer_host: "claude.ai",
        path_family: "category",
        count: 1,
      },
      {
        date: "2026-W01",
        referrer_host: "google.com",
        path_family: "pulse",
        count: 1,
      },
      {
        date: "2026-W01",
        referrer_host: "grok.com",
        path_family: "compare",
        count: 1,
      },
    ]);
  });

  test("does not count ordinary Google queries containing aio as AI referrers", () => {
    const input = JSON.stringify({
      timestamp: "2026-01-05T12:00:00.000Z",
      path: "/pulse",
      userAgent: "Mozilla/5.0",
      referer: "https://www.google.com/search?q=aiohttp+aioseo+usage",
      statusCode: 200,
    });

    const report = buildAiLogReport(input);

    expect(report.input_records).toBe(1);
    expect(report.referrer_counts).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("aiohttp");
    expect(JSON.stringify(report)).not.toContain("aioseo");
  });

  test("counts single records that carry batch-named array fields", () => {
    const input = JSON.stringify([
      {
        timestamp: "2026-01-05T12:00:00.000Z",
        path: "/about",
        userAgent: "GPTBot/1.0",
        statusCode: 200,
        data: [
          {
            timestamp: "2026-01-05T12:00:00.000Z",
            path: "/pulse",
            userAgent: "ClaudeBot/1.0",
            statusCode: 200,
          },
        ],
      },
      {
        timestamp: "2026-01-05T13:00:00.000Z",
        path: "/about",
        userAgent: "GPTBot/1.0",
        statusCode: 200,
        logs: [],
      },
      {
        timestamp: "2026-01-05T14:00:00.000Z",
        path: "/about",
        userAgent: "GPTBot/1.0",
        statusCode: 200,
        events: [],
      },
    ]);

    const report = buildAiLogReport(input);

    expect(report.input_records).toBe(3);
    expect(report.crawler_counts).toEqual([
      {
        date: "2026-01-05",
        user_agent_family: "GPTBot",
        path_family: "about",
        status_bucket: "2xx",
        count: 3,
      },
    ]);
  });

  test("documents the taxonomy in machine-readable output and markdown", () => {
    const report = buildAiLogReport("");
    const markdown = formatAiLogReportMarkdown(report);

    expect(report.taxonomy.crawler_user_agents.map((entry) => entry.family)).toEqual([
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "PerplexityBot",
      "Perplexity-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "anthropic-ai",
      "Google-Extended",
      "Applebot-Extended",
      "Applebot",
      "Bingbot",
      "CCBot",
    ]);
    expect(report.taxonomy.ai_referrers.map((entry) => entry.host)).toContain("chat.openai.com");
    expect(report.taxonomy.ai_referrers.map((entry) => entry.host)).toContain("x.com");
    expect(markdown).toContain("No matching AI crawler user-agent hits.");
    expect(markdown).toContain("Crawler user-agents: GPTBot, OAI-SearchBot, ChatGPT-User");
  });
});
