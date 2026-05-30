import { fmtK } from "@/lib/format";

type Point = { label: string; total: number };
export type Milestone = { stars: number; label: string; monthIndex: number; date: string };

// Server-rendered SVG area chart. Zero client JS. Amber gradient fill,
// gold milestone pins, CSS line-draw on load. Tolerates non-monotone series
// (recent net stars can dip) by taking the true series max for the y-scale.
export function StarCurve({ series, milestones }: { series: Point[]; milestones: Milestone[] }) {
  const W = 880;
  const H = 300;
  const padL = 6;
  const padR = 6;
  const padT = 28;
  const padB = 30;
  const n = series.length;
  const max = Math.max(1, ...series.map((p) => p.total));

  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / max) * (H - padT - padB);

  const line = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;

  // one tick per January present in the series
  const ticks = series
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.label.endsWith("-01"));

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Star history — rises to ${fmtK(max)} stars over ${n} months`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="amberFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--md-sys-color-primary-container)", stopOpacity: 0.5 }} />
            <stop offset="100%" style={{ stopColor: "var(--md-sys-color-primary-container)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>

        {/* baseline */}
        <line
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
          style={{ stroke: "var(--md-sys-color-outline-variant)" }}
          strokeWidth={1}
        />

        <path d={area} fill="url(#amberFade)" className="curve-area" />
        <path
          d={line}
          fill="none"
          pathLength={1}
          className="curve-line"
          style={{ stroke: "var(--md-sys-color-primary)" }}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {milestones.map((m) => {
          const mx = x(m.monthIndex);
          const my = y(m.stars);
          return (
            <g key={m.stars}>
              <line
                x1={mx}
                y1={my}
                x2={mx}
                y2={H - padB}
                style={{ stroke: "var(--md-sys-color-outline-variant)" }}
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <circle
                cx={mx}
                cy={my}
                r={5}
                style={{ fill: "var(--md-sys-color-primary-fixed-dim)", stroke: "var(--md-sys-color-surface)" }}
                strokeWidth={2}
              />
              <text
                x={mx}
                y={my - 11}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                style={{ fill: "var(--md-sys-color-on-surface)" }}
              >
                {m.label}
              </text>
            </g>
          );
        })}

        {ticks.map(({ p, i }) => (
          <text
            key={p.label}
            x={x(i)}
            y={H - 10}
            textAnchor="middle"
            fontSize={12}
            style={{ fill: "var(--md-sys-color-on-surface-variant)", fontFamily: "var(--font-mono)" }}
          >
            {p.label.slice(0, 4)}
          </text>
        ))}
      </svg>
    </figure>
  );
}
