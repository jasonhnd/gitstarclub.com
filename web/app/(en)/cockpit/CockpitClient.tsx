"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AS_OF,
  DOMAIN_COLORS,
  HEADLINES,
  MILESTONES,
  MONTHS,
  NODES,
  THIS_MONTH_DELTAS,
  flowAt,
  formatDelta,
  formatStars,
  monthIndex,
  nodeById,
  stockAt,
  type PosedNode,
} from "@/lib/cockpit/posed-frames";
import { COPY } from "@/lib/cockpit/copy";
import { mountRadar, type RadarHandle, type RadarNodeView } from "@/lib/cockpit/radar";

const AS_OF_INDEX = monthIndex(AS_OF);
const NEARBY = ["pytorch/pytorch", "huggingface/diffusers", "huggingface/datasets"] as const;

export function CockpitClient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const radarRef = useRef<RadarHandle | null>(null);
  const viewsRef = useRef<RadarNodeView[]>([]);
  const [month, setMonth] = useState(AS_OF_INDEX);
  const [selectedId, setSelectedId] = useState<string>(HEADLINES.movingNow);
  const [ready, setReady] = useState(false);

  const selected = nodeById(selectedId);
  const selectedStock = stockAt(selected, month);
  const views = useMemo(() => toViews(month), [month]);

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

  const onCanvasClick = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    const id = radarRef.current?.pick(event.clientX, event.clientY);
    if (id) setSelectedId(id);
  }, []);

  const period = MONTHS[month];
  const atToday = month === AS_OF_INDEX;
  const thisMonthDelta = THIS_MONTH_DELTAS[selectedId] ?? Math.max(0, flowAt(selected, AS_OF_INDEX));
  const milestones = MILESTONES[selectedId] ?? [];

  return (
    <div className="relative min-h-[calc(100svh-5.5rem)] bg-[#07080a]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-crosshair"
        data-testid="cockpit-radar"
        data-ready={ready ? "true" : "false"}
        onClick={onCanvasClick}
        aria-label={COPY.radar}
      />
      <div className="pointer-events-none absolute inset-x-5 top-4 z-10 flex justify-between font-mono text-[0.75rem] uppercase tracking-[0.12em] text-[#c3c7cf]">
        <span className="text-[#ffba3b]">{COPY.radar}</span>
        <span className="text-[#ffca74]" data-testid="cockpit-month">
          {period}
        </span>
      </div>

      {NODES.filter((n) => n.label && stockAt(n, month) > 0).map((n) => (
        <button
          key={n.id}
          type="button"
          className={`absolute z-10 -translate-x-1/2 -translate-y-[1.7rem] rounded-full px-2 py-0.5 text-[0.75rem] font-semibold ${
            n.id === selectedId ? "bg-[#f2a900] text-[#614200]" : "bg-black/50 text-[#e3e2e6]"
          }`}
          style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
          onClick={() => setSelectedId(n.id)}
        >
          {n.label}
        </button>
      ))}

      <aside className="absolute bottom-28 left-4 top-14 z-20 hidden w-[17.5rem] flex-col gap-2 overflow-auto rounded-2xl border border-white/10 bg-black/45 p-3 backdrop-blur-md xl:flex">
        <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[#ffba3b]">{COPY.now}</p>
        <Headline kicker={COPY.movingNow} id={HEADLINES.movingNow} active={selectedId === HEADLINES.movingNow} onSelect={setSelectedId} />
        <Headline
          kicker={COPY.speedingUp}
          signal={COPY.fasterThanLastMonth}
          id={HEADLINES.speedingUp}
          active={selectedId === HEADLINES.speedingUp}
          onSelect={setSelectedId}
        />
        <Headline
          kicker={COPY.newOnTheMap}
          signal={COPY.crossed10k}
          id={HEADLINES.newOnTheMap}
          active={selectedId === HEADLINES.newOnTheMap}
          onSelect={setSelectedId}
        />
      </aside>

      <aside className="absolute bottom-28 right-4 top-14 z-20 hidden w-[18.5rem] flex-col rounded-2xl border border-white/10 bg-black/45 p-4 backdrop-blur-md xl:flex">
        <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[#ffba3b]">{selected.id}</p>
        <p className="mt-2 font-mono text-[2.4rem] font-extrabold leading-none tabular-nums text-[#e3e2e6]" data-testid="cockpit-stars">
          {formatStars(selectedStock)}
          <span className="ml-2 text-[0.85rem] font-semibold text-[#ffba3b]">stars</span>
        </p>
        {!atToday ? <p className="mt-1 font-mono text-[0.75rem] text-[#c3c7cf]">{COPY.asOfPrefix} {period}</p> : null}
        <dl className="mt-4 space-y-2 font-mono text-[0.82rem] text-[#c3c7cf]">
          <div className="flex justify-between">
            <dt>{COPY.thisMonth}</dt>
            <dd className="text-[#ffba3b]">{formatDelta(thisMonthDelta)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{COPY.vsLastMonth}</dt>
            <dd className="text-[#e3e2e6]">{COPY.faster}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{COPY.inCategory}</dt>
            <dd className="text-[#e3e2e6]">#2 {COPY.was} #4</dd>
          </div>
        </dl>
        <p className="mt-6 font-mono text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#8d9199]">{COPY.nearby}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {NEARBY.map((name) => (
            <span key={name} className="rounded-xl border border-white/10 px-2 py-3 text-center font-mono text-[0.68rem] text-[#c3c7cf]">
              {name.split("/")[1]}
            </span>
          ))}
        </div>
        <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
          <Link href="/compare" className="inline-flex h-10 items-center justify-center rounded-full bg-[#f2a900] text-[0.85rem] font-bold text-[#614200]">
            {COPY.compare}
          </Link>
          <Link href={`/${selected.id}`} className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 text-[0.85rem] font-bold text-[#e3e2e6]">
            {COPY.fullHistory}
          </Link>
        </div>
      </aside>

      <div className="absolute inset-x-0 bottom-0 z-20">
        <Timeline month={month} milestones={milestones} onChange={setMonth} />
      </div>
    </div>
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
    <div className="border-t border-white/10 bg-black/70 px-5 py-4 backdrop-blur-md">
      <div className="mb-2 flex items-end justify-between gap-4">
        <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[#ffba3b]">{COPY.timeline}</p>
        <p className="font-mono text-[1.35rem] font-extrabold tabular-nums text-[#ffca74]">{MONTHS[month]}</p>
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
        className="relative h-16 cursor-ew-resize touch-none select-none pb-6"
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
        <div
          className="pointer-events-none absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#f2a900]"
          style={{ width: `${pct}%` }}
        />
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
      <div className="relative mt-6 h-4">
        {milestones.map((mark) => {
          const i = monthIndex(mark.period);
          const left = last === 0 ? 0 : (i / last) * 100;
          return (
            <button
              key={`${mark.stars}-${mark.period}`}
              type="button"
              className="absolute -translate-x-1/2 font-mono text-[0.65rem] text-[#c3c7cf]"
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
  active,
  onSelect,
}: {
  kicker: string;
  signal?: string;
  id: string;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const node = nodeById(id);
  const stars = stockAt(node, AS_OF_INDEX);
  const delta = THIS_MONTH_DELTAS[id] ?? 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`rounded-xl border p-3 text-left ${active ? "border-[#f2a900]/70 bg-white/10" : "border-white/10 bg-black/20"}`}
    >
      <p className="flex justify-between font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[#c3c7cf]">
        <span>{kicker}</span>
        {signal ? <span className="text-[#ffba3b]">{signal}</span> : null}
      </p>
      <p className="mt-1 font-mono text-[0.9rem] font-bold text-[#e3e2e6]">{id}</p>
      <p className="mt-1 font-mono text-[0.75rem] text-[#c3c7cf]">
        {formatStars(stars)} <span className="text-[#ffba3b]">{formatDelta(delta)} this month</span>
      </p>
    </button>
  );
}

function toViews(at: number): RadarNodeView[] {
  return NODES.map((node) => viewOf(node, at));
}

function viewOf(node: PosedNode, at: number): RadarNodeView {
  const stock = stockAt(node, at);
  const flow = flowAt(node, at);
  const maxStock = 240_000;
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    color: DOMAIN_COLORS[node.domain],
    size: stock <= 0 ? 0 : Math.max(0.08, Math.sqrt(stock / maxStock)),
    intensity: stock <= 0 ? 0 : flow > 0 ? Math.min(1, 0.4 + flow / 5_000) : 0.32,
    trail: 0,
  };
}
