// 2D force graph with adapters for the GraphDTO our backend returns.
//
// Simulation: classic repel + spring + center-pull on every tick.
// Rendering: canvas with curved edges, arrowheads, a selected-node wash,
// and labeled plates under each node. Drag a node to reposition. Click to select and highlight
// one-hop neighbors); click the background to deselect.

import { useEffect, useMemo, useRef } from "react";
import type { EdgeDTO, NodeDTO } from "../types";

interface Props {
  graph: { nodes: NodeDTO[]; edges: EdgeDTO[] };
  selectedUuid: string | null;
  onSelect: (uuid: string | null) => void;
  title: string;
  inkStyle?: boolean;
}

// CSS-var-resolved color palette for node rings. Read once per mount;
// re-resolved when the theme changes via a reseat effect below.
const KIND_COLOR_VARS: Record<string, string> = {
  Character: "--char-500",
  Scene: "--scene-500",
  PlotEvent: "--event-500",
  Beat: "--beat-500",
  Arc: "--arc-500",
  Theme: "--theme-500",
};

const GENERIC_LABELS = new Set(["Entity", "Episodic"]);

function resolveVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function nodeColor(node: NodeDTO): string {
  for (const label of node.labels) {
    if (GENERIC_LABELS.has(label)) continue;
    const varName = KIND_COLOR_VARS[label];
    if (varName) {
      const v = resolveVar(varName);
      if (v) return v;
    }
  }
  return resolveVar("--ink-600") || "#b3a687";
}

function nodeSize(node: NodeDTO): number {
  // Beats with a tension get extra weight so the climax visibly dominates.
  const tension = node.properties.tension_level as number | undefined;
  if (typeof tension === "number") return 8 + tension * 1.2;
  // Characters sit around 14; scenes smaller (10); others in between.
  if (node.labels.includes("Character")) return 14;
  if (node.labels.includes("Scene")) return 10;
  if (node.labels.includes("Theme")) return 14;
  if (node.labels.includes("Arc")) return 16;
  return 11;
}

interface SimNode {
  id: string;
  label: string;
  color: string;
  size: number;
  labels: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimEdge {
  source: string;
  target: string;
  type: string;
}

interface SimState {
  nodes: SimNode[];
  edges: SimEdge[];
  drag: { id: string; n: SimNode } | null;
  hover: string | null;
}

const REPEL = 1800;
const SPRING = 0.02;
const IDEAL_LEN = 78;
const DAMP = 0.86;
const CENTER = 0.012;

export default function ForceGraphPanel({
  graph,
  selectedUuid,
  onSelect,
  title,
  inkStyle,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<SimState | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);
  const selectedRef = useRef<string | null>(selectedUuid);
  selectedRef.current = selectedUuid;

  const neighborIndex = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!e.source || !e.target) continue;
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    return adj;
  }, [graph.edges]);

  // Seed / reseed the simulation whenever the graph data changes.
  useEffect(() => {
    const nodes: SimNode[] = graph.nodes.map((n) => ({
      id: n.uuid,
      label: n.name || n.uuid,
      color: nodeColor(n),
      size: nodeSize(n),
      labels: n.labels,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges: SimEdge[] = graph.edges
      .filter((e) => e.source && e.target && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: e.type }));

    // Seed positions on a jittered ring so the first few ticks don't
    // collapse the whole graph into a single pixel.
    const R = Math.max(120, Math.min(260, nodes.length * 8));
    nodes.forEach((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      n.x = Math.cos(a) * R * (0.6 + Math.random() * 0.4);
      n.y = Math.sin(a) * R * (0.6 + Math.random() * 0.4);
    });

    simRef.current = { nodes, edges, drag: null, hover: null };
  }, [graph]);

  // DPR-aware canvas sizing via ResizeObserver.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        sizeRef.current = { w: width, h: height };
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Simulation + render loop.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const sim = simRef.current;
      const { w, h } = sizeRef.current;
      if (!sim || w === 0 || h === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const { nodes, edges, drag } = sim;

      // Repulsion (pairwise, O(N²) — fine at <500 nodes).
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          const f = REPEL / d2;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Spring along edges.
      const idToNode = new Map(nodes.map((n) => [n.id, n]));
      for (const e of edges) {
        const a = idToNode.get(e.source);
        const b = idToNode.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const diff = d - IDEAL_LEN;
        const f = diff * SPRING;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // Center pull + damp + integrate.
      for (const n of nodes) {
        if (drag && drag.id === n.id) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx -= n.x * CENTER;
        n.vy -= n.y * CENTER;
        n.vx *= DAMP;
        n.vy *= DAMP;
        n.x += n.vx;
        n.y += n.vy;
      }

      // ==== Render ====
      const canvas = canvasRef.current;
      if (!canvas) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      const selected = selectedRef.current;
      const isHighlighted = (id: string): boolean => {
        if (!selected) return true;
        if (id === selected) return true;
        return !!neighborIndex.get(selected)?.has(id);
      };

      // Radial ink-wash behind selected node.
      if (inkStyle && selected) {
        const sel = nodes.find((n) => n.id === selected);
        if (sel) {
          const grad = ctx.createRadialGradient(
            cx + sel.x,
            cy + sel.y,
            10,
            cx + sel.x,
            cy + sel.y,
            240,
          );
          grad.addColorStop(0, "rgba(228,0,43,0.12)");
          grad.addColorStop(1, "rgba(228,0,43,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);
        }
      }

      // Edges with a slight curve + arrowhead on highlighted edges.
      for (const e of edges) {
        const a = idToNode.get(e.source);
        const b = idToNode.get(e.target);
        if (!a || !b) continue;
        const hi =
          !selected ||
          (isHighlighted(a.id) && isHighlighted(b.id) && (a.id === selected || b.id === selected));
        ctx.strokeStyle = hi ? "rgba(228,0,43,0.7)" : "rgba(5,5,5,0.14)";
        ctx.lineWidth = hi ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(cx + a.x, cy + a.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // Slight perpendicular offset keeps related edges readable.
        ctx.quadraticCurveTo(cx + mx + 2, cy + my - 2, cx + b.x, cy + b.y);
        ctx.stroke();

        if (hi) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / d;
          const uy = dy / d;
          const tipX = cx + b.x - ux * (b.size + 4);
          const tipY = cy + b.y - uy * (b.size + 4);
          ctx.fillStyle = "rgba(228,0,43,0.8)";
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * 7 + uy * 4, tipY - uy * 7 - ux * 4);
          ctx.lineTo(tipX - ux * 7 - uy * 4, tipY - uy * 7 + ux * 4);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Nodes + labeled plates.
      for (const n of nodes) {
        const sel = n.id === selected;
        const dim = selected && !isHighlighted(n.id);
        const r = n.size;

        // Halo on selected node.
        if (sel) {
          ctx.beginPath();
          ctx.fillStyle = n.color + "33";
          ctx.arc(cx + n.x, cy + n.y, r + 10, 0, Math.PI * 2);
          ctx.fill();
        }

        // Disc.
        ctx.beginPath();
        ctx.arc(cx + n.x, cy + n.y, r, 0, Math.PI * 2);
          ctx.fillStyle = dim ? "rgba(5,5,5,0.35)" : n.color;
        ctx.fill();
        if (sel) {
          ctx.strokeStyle = resolveVar("--ink-900") || "#f7f1df";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Label plate behind text so names stay legible over curves.
        if (n.label) {
          const text = n.label.length > 10 ? n.label.slice(0, 9) + "…" : n.label;
          ctx.font = `${sel ? 600 : 500} 12px "Helvetica Neue", "Noto Sans SC", Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const tx = cx + n.x;
          const ty = cy + n.y + r + 5;
          const tw = ctx.measureText(text).width;
          ctx.fillStyle = dim ? "rgba(255,255,255,0.64)" : "rgba(255,255,255,0.88)";
          ctx.fillRect(tx - tw / 2 - 5, ty - 1, tw + 10, 16);
          ctx.fillStyle = dim
            ? "rgba(111,111,118,0.72)"
            : resolveVar("--ink-800") || "#ece3cb";
          ctx.fillText(text, tx, ty);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [graph, inkStyle, neighborIndex]);

  // Pointer handlers — drag nodes, click to select.
  const locateNode = (clientX: number, clientY: number): SimNode | null => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left - rect.width / 2;
    const my = clientY - rect.top - rect.height / 2;
    for (const n of sim.nodes) {
      const dx = n.x - mx;
      const dy = n.y - my;
      if (dx * dx + dy * dy < (n.size + 5) ** 2) return n;
    }
    return null;
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const n = locateNode(e.clientX, e.clientY);
    if (n) {
      simRef.current!.drag = { id: n.id, n };
      onSelect(n.id);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } else {
      onSelect(null);
    }
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sim = simRef.current;
    if (!sim || !sim.drag) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    sim.drag.n.x = mx;
    sim.drag.n.y = my;
  };
  const onUp = () => {
    if (simRef.current) simRef.current.drag = null;
  };

  return (
    <div
      ref={wrapRef}
      className={inkStyle ? "ink-vignette" : ""}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: inkStyle
          ? undefined
          : "linear-gradient(90deg, var(--hairline) 1px, transparent 1px), linear-gradient(180deg, var(--hairline) 1px, transparent 1px), var(--ink-000)",
        backgroundSize: inkStyle ? undefined : "96px 96px, 96px 96px, auto",
        cursor: "grab",
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 14,
          fontWeight: 700,
          color: "var(--ink-900)",
          fontSize: 13,
          pointerEvents: "none",
          zIndex: 2,
        }}
      >
        <span className="mono" style={{ color: "#e4002b", marginRight: 8 }}>
          {title === "详细图谱" ? "04A" : "04B"}
        </span>
        {title}
      </div>
      <div
        className="kicker"
        style={{
          position: "absolute",
          top: 14,
          right: 16,
          fontSize: 10,
          pointerEvents: "none",
          zIndex: 2,
        }}
      >
        {graph.nodes.length} 节点 · {graph.edges.length} 关系
      </div>
    </div>
  );
}
