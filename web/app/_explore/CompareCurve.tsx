"use client";

import { useState } from "react";
import { fmtStars } from "@/lib/format";
import type { CompareCurve as CompareCurveData } from "@/lib/contracts";
import { type CompareMode, buildChart } from "@/lib/compare/core";

// Multi-line overlay chart for /compare (v0.2 §5). Shares the SVG approach with StarCurve but:
// - N lines instead of one, distinct colors from --chart-cat-1..5
// - no area fill (would muddy overlap)
// - segmented mode toggle (absolute calendar ↔ months-since-crossing-10k)
// All normalization lives in lib/compare/core (pure, unit-tested) — this component is just SVG.
// Client component because of the mode toggle (zero-JS exception ④, DESIGN-SYSTEM §219).

interface CompareCurveProps {
  curves: ReadonlyArray<CompareCurveData>;
  initialMode?: CompareMode;
  modeLabels: { absolute: string; align10k: string };
  legendAria: string;
}

const W = 880;
const H = 300;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 30;

export function CompareCurve({ curves, initialMode = "absolute", modeLabels, legendAria }: CompareCurveProps) {
  const [mode, setMode] = useState<CompareMode>(initialMode);
  const chart = buildChart(curves, mode);
  const x = (v: number) => PAD_L + (v / Math.max(1, chart.xMax)) * (W - PAD_L - PAD_R);
  const y = (v: number) => H - PAD_B - (v / Math.max(1, chart.yMax)) * (H - PAD_T - PAD_B);
  const yTicks = [0, Math.round(chart.yMax / 2), chart.yMax];

  return (
    <figure className="m-0">
      <div
        role="group"
        aria-label={modeLabels.absolute + " / " + modeLabels.align10k}
        className="mb-3 inline-flex rounded-full border border-outline-variant bg-surface-container p-0.5 font-mono text-[0.78rem]"
      >
        {(["absolute", "align10k"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={m === mode}
            className={`rounded-full px-3 py-1 transition-colors ${
              m === mode
                ? "bg-secondary-container text-on-secondary-container"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Star history overlay of ${chart.lines.length} repositories (${mode})`}
        preserveAspectRatio="none"
      >
        {/* baseline */}
        <line
          x1={PAD_L}
          y1={H - PAD_B}
          x2={W - PAD_R}
          y2={H - PAD_B}
          style={{ stroke: "var(--md-sys-color-outline-variant)" }}
          strokeWidth={1}
        />

        {/* y-axis ticks: faint gridlines + mono labels */}
        {yTicks.map((v) => (
          <g key={`yt-${v}`}>
            <line
              x1={PAD_L}
              y1={y(v)}
              x2={W - PAD_R}
              y2={y(v)}
              style={{ stroke: "var(--md-sys-color-outline-variant)", strokeOpacity: 0.3 }}
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={y(v) + 4}
              textAnchor="end"
              fontSize={11}
              style={{ fill: "var(--md-sys-color-on-surface-variant)", fontFamily: "var(--font-mono)" }}
            >
              {fmtStars(v)}
            </text>
          </g>
        ))}

        {/* one line per repo */}
        {chart.lines.map((line) => {
          const pts = [...line.points].sort((a, b) => a.x - b.x);
          if (pts.length === 0) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
          return (
            <path
              key={line.full_name}
              d={d}
              fill="none"
              style={{ stroke: `var(${line.colorVar})` }}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* x-axis tick labels (years for absolute, "10k"/"+Ny" for align) */}
        {chart.xTicks.map((t) => (
          <text
            key={`xt-${t.x}-${t.label}`}
            x={x(t.x)}
            y={H - 10}
            textAnchor="middle"
            fontSize={12}
            style={{ fill: "var(--md-sys-color-on-surface-variant)", fontFamily: "var(--font-mono)" }}
          >
            {t.label}
          </text>
        ))}
      </svg>

      <ul aria-label={legendAria} className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[0.78rem]">
        {chart.lines.map((line) => (
          <li key={line.full_name} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-3 rounded-sm"
              style={{ background: `var(${line.colorVar})` }}
            />
            <span className="text-on-surface">{line.full_name}</span>
            <span className="tabular-nums text-on-surface-variant">{fmtStars(line.current_stars)} ★</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
