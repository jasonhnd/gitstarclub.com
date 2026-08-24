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
    <div className="flex min-h-[calc(100svh-8.5rem)] flex-col gap-3 px-[clamp(1.25rem,5vw,2.5rem)] pb-4 pt-3">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[18rem_minmax(0,1fr)_19rem]">
        <aside className="flex flex-col gap-2 rounded-[1.25rem] border border-outline-variant bg-surface-container p-3">
          <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.12em] text-primary-fixed-dim">{COPY.now}</p>
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

        <section className="relative min-h-[28rem] overflow-hidden rounded-[1.25rem] border border-outline-variant bg-[#0b0c0e]">
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-between font-mono text-[0.72rem] uppercase tracking-[0.08em] text-[#c3c7cf]">
            <span className="text-[#ffba3b]">{COPY.radar}</span>
            <span>
              {COPY.asOfPrefix} {period}
            </span>
          </div>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-pointer"
            data-testid="cockpit-radar"
            data-ready={ready ? "true" : "false"}
            onClick={onCanvasClick}
            aria-label={COPY.radar}
          />
          {NODES.filter((n) => n.label && stockAt(n, month) > 0).map((n) => (
            <button
              key={n.id}
              type="button"
              className={`pointer-events-auto absolute z-10 -translate-x-1/2 -translate-y-[1.6rem] rounded-full px-2 py-0.5 font-sans text-[0.75rem] font-semibold ${
                n.id === selectedId ? "bg-[#f2a900] text-[#614200]" : "bg-black/55 text-[#e3e2e6]"
              }`}
              style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
              onClick={() => setSelectedId(n.id)}
            >
              {n.label}
            </button>
          ))}
        </section>

        <aside className="flex flex-col rounded-[1.25rem] border border-outline-variant bg-surface-container p-4">
          <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.08em] text-primary-fixed-dim">{selected.id}</p>
          <p className="mt-2 font-mono text-[2.4rem] font-extrabold leading-none tabular-nums text-on-surface" data-testid="cockpit-stars">
            {formatStars(selectedStock)}
            <span className="ml-2 text-[0.85rem] font-semibold text-primary-fixed-dim">stars</span>
          </p>
          {!atToday ? (
            <p className="mt-1 font-mono text-[0.75rem] text-on-surface-variant">
              {COPY.asOfPrefix} {period}
            </p>
          ) : null}
          <dl className="mt-4 space-y-2 font-mono text-[0.82rem] text-on-surface-variant">
            <div className="flex justify-between">
              <dt>{COPY.thisMonth}</dt>
              <dd className="text-primary-fixed-dim">{formatDelta(thisMonthDelta)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{COPY.vsLastMonth}</dt>
              <dd className="text-on-surface">{COPY.faster}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{COPY.inCategory}</dt>
              <dd className="text-on-surface">
                #2 {COPY.was} #4
              </dd>
            </div>
          </dl>
          <p className="mt-6 font-mono text-[0.7rem] font-bold uppercase tracking-[0.1em] text-on-surface-variant">{COPY.nearby}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {NEARBY.map((name) => (
              <span key={name} className="rounded-xl border border-outline-variant px-2 py-3 text-center font-mono text-[0.68rem] text-on-surface-variant">
                {name.split("/")[1]}
              </span>
            ))}
          </div>
          <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
            <Link
              href="/compare"
              className="inline-flex h-10 items-center justify-center rounded-full bg-primary-container text-[0.85rem] font-bold text-on-primary-container"
            >
              {COPY.compare}
            </Link>
            <Link
              href={`/${selected.id}`}
              className="inline-flex h-10 items-center justify-center rounded-full border border-outline-variant text-[0.85rem] font-bold text-on-surface"
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

  return (
    <div className="rounded-[1.15rem] border border-outline-variant bg-surface-container px-4 py-3">
      <p className="mb-2 font-mono text-[0.72rem] font-bold uppercase tracking-[0.08em] text-on-surface-variant">{COPY.timeline}</p>
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
        className="relative h-12 cursor-ew-resize touch-none select-none rounded-full bg-surface-container-high"
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
        <div className="pointer-events-none absolute inset-y-[1.35rem] left-3 right-3 rounded-full bg-outline-variant" />
        <div
          className="pointer-events-none absolute inset-y-[1.35rem] left-3 rounded-full bg-primary-container"
          style={{ width: pct <= 0 ? "0px" : `calc(${pct}% - 0.75rem)` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#1a1408] bg-primary-container shadow-[0_0_12px_rgba(242,169,0,0.55)]"
          style={{ left: `calc(12px + ${pct / 100} * (100% - 24px))` }}
        />
      </div>
      <div className="relative mt-2 h-5">
        {milestones.map((mark) => {
          const i = monthIndex(mark.period);
          const left = last === 0 ? 0 : (i / last) * 100;
          return (
            <button
              key={`${mark.stars}-${mark.period}`}
              type="button"
              className="absolute -translate-x-1/2 font-mono text-[0.65rem] text-on-surface-variant"
              style={{ left: `${left}%` }}
              onClick={() => onChange(i)}
            >
              {mark.period} · {mark.stars / 1000}k
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-right font-mono text-[0.85rem] font-semibold text-primary-fixed-dim" data-testid="cockpit-month">
        {MONTHS[month]}
      </p>
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
      className={`rounded-xl border p-3 text-left ${active ? "border-primary-container bg-surface-container-high" : "border-outline-variant bg-surface-container"}`}
    >
      <p className="flex justify-between font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-on-surface-variant">
        <span>{kicker}</span>
        {signal ? <span className="text-primary-fixed-dim">{signal}</span> : null}
      </p>
      <p className="mt-1 font-mono text-[0.9rem] font-bold text-on-surface">{id}</p>
      <p className="mt-1 font-mono text-[0.75rem] text-on-surface-variant">
        {formatStars(stars)} <span className="text-primary-fixed-dim">{formatDelta(delta)} this month</span>
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
    size: stock <= 0 ? 0 : Math.max(0.06, stock / maxStock),
    intensity: stock <= 0 ? 0 : flow > 0 ? Math.min(1, 0.35 + flow / 4_000) : 0.28,
    trail: 0,
  };
}
