"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AS_OF,
  DOMAIN_COLORS,
  DOMAIN_LEGEND,
  HEADLINES,
  MILESTONES,
  MONTHS,
  NODES,
  formatDelta,
  formatStars,
  inCategory,
  isClimbing,
  isFaster,
  isTrackedRepo,
  monthIndex,
  nearbyOf,
  nodeById,
  sparkValues,
  stockAt,
  windowDelta,
  type MotionWindow,
  type PosedNode,
} from "@/lib/cockpit/posed-frames";
import { COPY } from "@/lib/cockpit/copy";
import { mountRadar, type RadarHandle, type RadarNodeView } from "@/lib/cockpit/radar";

const AS_OF_INDEX = monthIndex(AS_OF);
const CHIP_ORDER: MotionWindow[] = ["week", "month", "year"];
const SEARCHABLE = NODES.filter((node) => node.label);
const GLASS =
  "rounded-[1.25rem] border border-[#f2a900]/15 bg-[#1a1c1e]/82 shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-md";

export function CockpitClient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const radarRef = useRef<RadarHandle | null>(null);
  const viewsRef = useRef<RadarNodeView[]>([]);
  const [month, setMonth] = useState(AS_OF_INDEX);
  const [motion, setMotion] = useState<MotionWindow>("month");
  const [selectedId, setSelectedId] = useState<string>(HEADLINES.movingNow);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);

  const selected = nodeById(selectedId);
  const selectedStock = stockAt(selected, month);
  const storyDelta = windowDelta(selected, AS_OF_INDEX, motion);
  const views = useMemo(() => toViews(month, selectedId, motion), [month, selectedId, motion]);
  const chipLabel = motion === "week" ? COPY.thisWeek : motion === "year" ? COPY.thisYear : COPY.thisMonth;
  const radarTitle = motion === "week" ? "Open source this week" : motion === "year" ? "Open source this year" : COPY.radar;
  const neighbors = useMemo(() => nearbyOf(selectedId), [selectedId]);
  const category = inCategory(selected);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return SEARCHABLE.filter((node) => node.id.toLowerCase().includes(needle) || node.label?.toLowerCase().includes(needle)).slice(0, 6);
  }, [query]);
  const named = useMemo(() => namedLabels(month, selectedId), [month, selectedId]);

  useEffect(() => {
    viewsRef.current = views;
    radarRef.current?.setNodes(views);
  }, [views]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    void mountRadar(canvas).then((radar) => {
      if (disposed) {
        radar.dispose();
        return;
      }
      radarRef.current = radar;
      radar.setNodes(viewsRef.current);
      setReady(true);
      resizeObserver = new ResizeObserver(() => {
        radar.resize();
        radar.setNodes(viewsRef.current);
      });
      resizeObserver.observe(canvas);
    });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      radarRef.current?.dispose();
      radarRef.current = null;
    };
  }, []);

  const pickAt = useCallback((clientX: number, clientY: number) => radarRef.current?.pick(clientX, clientY) ?? null, []);

  const onCanvasClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const id = pickAt(event.clientX, event.clientY);
      if (id) setSelectedId(id);
    },
    [pickAt],
  );

  const onCanvasMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const id = pickAt(event.clientX, event.clientY);
      if (!id) {
        setHover(null);
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      setHover({ id, x: event.clientX - rect.left, y: event.clientY - rect.top });
    },
    [pickAt],
  );

  const selectRepo = useCallback((id: string) => {
    setSelectedId(id);
    setQuery("");
  }, []);

  const period = MONTHS[month];
  const atToday = month === AS_OF_INDEX;
  const milestones = MILESTONES[selectedId] ?? [];
  const compareHref = isTrackedRepo(selectedId) ? `/compare?repos=${encodeURIComponent(selectedId)}` : "/compare";
  const historyHref = isTrackedRepo(selectedId) ? `/${selectedId}` : "/pulse";

  return (
    <div className="flex min-h-[calc(100svh-5.5rem)] flex-col bg-[#07080a] text-[#e3e2e6] lg:h-[calc(100svh-5.5rem)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#f2a900]/15 bg-[#0d0e11]/80 px-[clamp(1rem,3vw,1.75rem)] py-3 backdrop-blur-md">
        <p className="font-sans text-[0.95rem] font-medium tracking-[0.01em] text-[#c3c7cf]">{COPY.lede}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <label className="sr-only" htmlFor="cockpit-search">
              {COPY.searchHint}
            </label>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8d9199]" aria-hidden>
              <SearchIcon />
            </span>
            <input
              id="cockpit-search"
              data-testid="cockpit-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches[0]) selectRepo(matches[0].id);
              }}
              placeholder={COPY.search}
              className="h-9 w-[min(18rem,70vw)] rounded-full border border-white/10 bg-[#1a1c1e] py-0 pl-9 pr-4 font-sans text-[0.82rem] text-[#e3e2e6] placeholder:text-[#8d9199] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900]"
            />
            {matches.length > 0 ? (
              <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-[#1a1c1e] py-1 shadow-lg">
                {matches.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left font-mono text-[0.8rem] text-[#e3e2e6] hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                      onClick={() => selectRepo(node.id)}
                    >
                      {node.id}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex gap-1" role="group" aria-label="Motion window">
            {CHIP_ORDER.map((chip) => {
              const label = chip === "week" ? COPY.thisWeek : chip === "year" ? COPY.thisYear : COPY.thisMonth;
              const on = motion === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={on}
                  data-testid={`cockpit-chip-${chip}`}
                  onClick={() => setMotion(chip)}
                  className={`h-8 rounded-full px-3 font-mono text-[0.7rem] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900] ${
                    on ? "border border-[#f2a900]/40 bg-[#f2a900]/20 text-[#ffca74]" : "border border-transparent text-[#c3c7cf] hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-[#8d9199]">
            {COPY.asOfPrefix} {AS_OF}
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[20.5rem_minmax(0,1fr)_22.25rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        <aside className={`${GLASS} order-2 flex min-h-0 flex-col gap-2 overflow-y-auto p-3 lg:order-1 lg:min-h-0`}>
          <p className="flex items-center gap-2 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#ffba3b]">
            <span className="size-1.5 rounded-full bg-[#f2a900] shadow-[0_0_8px_#f2a900]" />
            {COPY.now}
          </p>
          <Headline
            kicker={COPY.movingNow}
            id={HEADLINES.movingNow}
            motion={motion}
            chipLabel={chipLabel}
            active={selectedId === HEADLINES.movingNow}
            spark="#f2a900"
            onSelect={selectRepo}
          />
          <Headline
            kicker={COPY.speedingUp}
            signal={COPY.fasterThanLastMonth}
            id={HEADLINES.speedingUp}
            motion={motion}
            chipLabel={chipLabel}
            active={selectedId === HEADLINES.speedingUp}
            spark="#4ade80"
            onSelect={selectRepo}
          />
          <Headline
            kicker={COPY.newOnTheMap}
            signal={COPY.crossed10k}
            id={HEADLINES.newOnTheMap}
            motion={motion}
            chipLabel={chipLabel}
            active={selectedId === HEADLINES.newOnTheMap}
            spark="#9edaff"
            onSelect={selectRepo}
          />
        </aside>

        <div className="relative order-1 min-h-[22rem] overflow-hidden rounded-[1.35rem] border border-[#f2a900]/15 bg-[#0b0c0e] shadow-[inset_0_0_80px_rgba(13,14,17,0.55)] lg:order-2 lg:min-h-0">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 80% 70% at 52% 44%, rgba(242,169,0,0.05), transparent 58%), radial-gradient(ellipse 50% 40% at 80% 18%, rgba(158,218,255,0.03), transparent 50%)",
            }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-crosshair"
            data-testid="cockpit-radar"
            data-ready={ready ? "true" : "false"}
            onClick={onCanvasClick}
            onMouseMove={onCanvasMove}
            onMouseLeave={() => setHover(null)}
            aria-label={radarTitle}
          />
          <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex justify-between font-mono text-[0.68rem] uppercase tracking-[0.12em] text-[#c3c7cf]">
            <span className="text-[#ffba3b]">{radarTitle}</span>
            <span className="text-[#ffca74]" data-testid="cockpit-month">
              {period}
            </span>
          </div>
          <ul className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex flex-wrap gap-3 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.04em] text-[#8d9199]">
            {DOMAIN_LEGEND.map((item) => (
              <li key={item.id} className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: DOMAIN_COLORS[item.id] }} />
                {item.label}
              </li>
            ))}
          </ul>
          {named.map((node) => (
            <button
              key={node.id}
              type="button"
              className={`absolute z-10 -translate-x-1/2 -translate-y-[1.7rem] rounded-full px-2 py-0.5 text-[0.75rem] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900] ${
                node.id === selectedId ? "bg-[#f2a900] text-[#614200]" : "bg-black/50 text-[#e3e2e6]"
              }`}
              style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
              onClick={() => selectRepo(node.id)}
            >
              {node.label}
            </button>
          ))}
          {hover ? <HoverCard hover={hover} month={month} motion={motion} chipLabel={chipLabel} /> : null}
        </div>

        <aside className={`${GLASS} order-3 flex min-h-0 flex-col overflow-y-auto p-3 lg:min-h-0`}>
          <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[#ffba3b]">{selected.id}</p>
          <p className="mt-2 flex items-baseline gap-2 font-mono leading-none" data-testid="cockpit-stars">
            <span className="text-[2.4rem] font-extrabold tabular-nums tracking-[-0.03em]">{formatStars(selectedStock)}</span>
            <span className="text-[0.85rem] font-semibold text-[#ffba3b]">{COPY.stars}</span>
          </p>
          {!atToday ? (
            <p className="mt-1 font-mono text-[0.75rem] text-[#c3c7cf]">
              {COPY.asOfPrefix} {period}
            </p>
          ) : null}
          <dl className="mt-4 space-y-2 font-mono text-[0.82rem] text-[#c3c7cf]">
            <div className="flex justify-between">
              <dt>{chipLabel}</dt>
              <dd className="text-[#ffba3b]" data-testid="cockpit-window-delta">
                {formatDelta(storyDelta)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>{COPY.vsLastMonth}</dt>
              <dd className="text-[#e3e2e6]">{isFaster(selected, AS_OF_INDEX, motion) ? COPY.faster : COPY.empty}</dd>
            </div>
            {isClimbing(selected, AS_OF_INDEX) ? (
              <div className="flex justify-between">
                <dt />
                <dd className="text-[#4ade80]">{COPY.climbing}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt>{category?.label ?? COPY.inCategory}</dt>
              <dd className="text-[#e3e2e6]">
                {category ? `#${category.rank} ${COPY.was} #${category.prev}` : COPY.empty}
              </dd>
            </div>
          </dl>
          <p className="mt-4 font-mono text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#8d9199]">{COPY.last90Days}</p>
          <Sparkline values={sparkValues(selected, AS_OF_INDEX)} color="#f2a900" />
          <p className="mt-4 font-mono text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#8d9199]">{COPY.nearby}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {neighbors.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => selectRepo(name)}
                className="rounded-xl border border-white/10 bg-[#0d0e11]/70 px-2 py-3 text-center font-mono text-[0.68rem] text-[#c3c7cf] hover:border-[#f2a900]/40 hover:text-[#e3e2e6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900]"
              >
                {name.split("/")[1]}
              </button>
            ))}
          </div>
          <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
            <Link
              href={compareHref}
              className="inline-flex h-10 items-center justify-center rounded-full bg-[#f2a900] text-[0.85rem] font-bold text-[#614200] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffca74]"
            >
              {COPY.compare}
            </Link>
            <Link
              href={historyHref}
              className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 text-[0.85rem] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900]"
            >
              {COPY.fullHistory}
            </Link>
          </div>
        </aside>
      </div>

      <Timeline month={month} milestones={milestones} onChange={setMonth} />
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11.5 14 14.5" />
    </svg>
  );
}

function HoverCard({
  hover,
  month,
  motion,
  chipLabel,
}: {
  hover: { id: string; x: number; y: number };
  month: number;
  motion: MotionWindow;
  chipLabel: string;
}) {
  const node = nodeById(hover.id);
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-xl border border-white/10 bg-black/80 px-3 py-2 font-mono text-[0.75rem] text-[#e3e2e6] shadow-lg"
      style={{ left: hover.x + 12, top: hover.y + 12 }}
      data-testid="cockpit-hover"
    >
      <p className="font-bold">{node.id}</p>
      <p className="text-[#c3c7cf]">
        {formatStars(stockAt(node, month))} {COPY.stars}
      </p>
      <p className="text-[#ffba3b]">
        {formatDelta(windowDelta(node, month, motion))} {chipLabel.toLowerCase()}
      </p>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const d = values
    .map((value, i) => {
      const x = values.length === 1 ? 0 : (i / (values.length - 1)) * 88;
      const y = 26 - ((value - min) / span) * 22;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg data-testid="cockpit-spark" viewBox="0 0 88 28" className="mt-1 h-7 w-full" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function Timeline({
  month,
  milestones,
  onChange,
}: {
  month: number;
  milestones: { stars: number; period: string }[];
  onChange: (index: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const last = MONTHS.length - 1;
  const pct = last === 0 ? 0 : (month / last) * 100;

  const setFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const t = (clientX - rect.left) / Math.max(1, rect.width);
    onChange(Math.round(Math.min(1, Math.max(0, t)) * last));
  };

  const years = Array.from(new Set(MONTHS.map((p) => p.slice(0, 4))));

  return (
    <div className={`mx-3 mb-3 shrink-0 ${GLASS} px-5 py-3`}>
      <div className="mb-1 flex items-end justify-between gap-4">
        <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[#ffba3b]">{COPY.timeline}</p>
        <p className="font-mono text-[1.15rem] font-extrabold tabular-nums text-[#ffca74]">{MONTHS[month]}</p>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={COPY.playhead}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={month}
        aria-valuetext={MONTHS[month]}
        data-testid="cockpit-timeline"
        className="relative h-12 cursor-ew-resize touch-none select-none pb-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900]"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0) return;
          setFromClientX(event.clientX);
        }}
        onKeyDown={(event) => {
          if (event.key === "Home") {
            event.preventDefault();
            onChange(0);
          } else if (event.key === "End") {
            event.preventDefault();
            onChange(last);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            onChange(Math.max(0, month - 1));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onChange(Math.min(last, month + 1));
          }
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/15" />
        <div className="pointer-events-none absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#f2a900]" style={{ width: `${pct}%` }} />
        <div
          className="pointer-events-none absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#1a1408] bg-[#f2a900] shadow-[0_0_18px_rgba(242,169,0,0.7)]"
          style={{ left: `${pct}%` }}
        />
        {years.map((year) => {
          const i = MONTHS.findIndex((p) => p.startsWith(`${year}-`));
          if (i < 0) return null;
          const left = (i / last) * 100;
          return (
            <span key={year} className="pointer-events-none absolute bottom-0 -translate-x-1/2 font-mono text-[0.65rem] text-[#8d9199]" style={{ left: `${left}%` }}>
              {year}
            </span>
          );
        })}
      </div>
      <div className="relative mt-1 h-4">
        {milestones.map((mark) => {
          const i = monthIndex(mark.period);
          const left = last === 0 ? 0 : (i / last) * 100;
          return (
            <button
              key={`${mark.stars}-${mark.period}`}
              type="button"
              className="absolute -translate-x-1/2 font-mono text-[0.65rem] text-[#c3c7cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900]"
              style={{ left: `${left}%` }}
              onClick={() => onChange(i)}
            >
              {mark.stars / 1000}k
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Headline({
  kicker,
  signal,
  id,
  motion,
  chipLabel,
  active,
  spark,
  onSelect,
}: {
  kicker: string;
  signal?: string;
  id: string;
  motion: MotionWindow;
  chipLabel: string;
  active: boolean;
  spark: string;
  onSelect: (id: string) => void;
}) {
  const node = nodeById(id);
  const stars = stockAt(node, AS_OF_INDEX);
  const delta = windowDelta(node, AS_OF_INDEX, motion);
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`rounded-xl border p-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900] ${
        active ? "border-[#f2a900]/70 bg-[#f2a900]/10" : "border-white/10 bg-black/20 hover:border-white/20"
      }`}
    >
      <p className="flex justify-between font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[#eac080]">
        <span>{kicker}</span>
        {signal ? <span className="normal-case tracking-normal text-[#4ade80]">{signal}</span> : null}
      </p>
      <p className="mt-1 font-mono text-[0.9rem] font-bold">{id}</p>
      <p className="mt-1 font-mono text-[0.75rem] text-[#c3c7cf]">
        {formatStars(stars)}{" "}
        <span className="text-[#ffba3b]">
          {formatDelta(delta)} {chipLabel.toLowerCase()}
        </span>
      </p>
      <Sparkline values={sparkValues(node, AS_OF_INDEX)} color={spark} />
    </button>
  );
}

function namedLabels(at: number, selectedId: string): PosedNode[] {
  const labeled = NODES.filter((node) => node.label && stockAt(node, at) > 0);
  const prefer = new Set<string>([selectedId, HEADLINES.movingNow, HEADLINES.speedingUp, HEADLINES.newOnTheMap]);
  const first = labeled.filter((node) => prefer.has(node.id));
  const rest = labeled.filter((node) => !prefer.has(node.id));
  return [...first, ...rest].slice(0, 6);
}

function toViews(at: number, selectedId: string, motion: MotionWindow): RadarNodeView[] {
  return NODES.map((node) => viewOf(node, at, selectedId, motion));
}

function viewOf(node: PosedNode, at: number, selectedId: string, motion: MotionWindow): RadarNodeView {
  const stock = stockAt(node, at);
  const flow = windowDelta(node, at, motion);
  const faster = isFaster(node, at, motion);
  const maxStock = 240_000;
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    color: DOMAIN_COLORS[node.domain],
    size: stock <= 0 ? 0 : Math.max(0.08, Math.sqrt(stock / maxStock)) * (node.id === selectedId ? 1.35 : 1),
    intensity: stock <= 0 ? 0 : flow > 0 ? Math.min(1, 0.4 + flow / 5_000 + (faster ? 0.12 : 0)) : 0.22,
    trail: faster ? 1 : 0,
  };
}
