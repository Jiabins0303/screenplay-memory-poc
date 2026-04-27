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
  // Phase 12 wires these in from Graph.tsx; Phase 10 leaves them optional so
  // the existing Graph.tsx call sites still compile until Phase 13.
  selectedEdgeUuid?: string | null;
  onSelectEdge?: (uuid: string | null) => void;
}

// CSS-var-resolved color palette for node rings. Read once per mount;
// re-resolved when the theme changes via a reseat effect below.
const KIND_COLOR_VARS: Record<string, string> = {
  Character: "--char-500",
  Identity: "--ident-500",
  Family: "--family-500",
  Organization: "--org-500",
  Location: "--loc-500",
  Item: "--item-500",
  Misunderstanding: "--mis-500",
  Secret: "--secret-500",
  Scene: "--scene-500",
  PlotEvent: "--event-500",
  Beat: "--beat-500",
  Arc: "--arc-500",
  Theme: "--theme-500",
  Trope: "--trope-500",
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
  const tension = node.properties.tension_level as number | undefined;
  if (typeof tension === "number") return 8 + tension * 1.2;
  if (node.labels.includes("Character")) return 14;
  if (node.labels.includes("Arc")) return 16;
  if (node.labels.includes("Theme")) return 14;
  if (node.labels.includes("Family")) return 13;
  if (node.labels.includes("Trope")) return 13;
  if (node.labels.includes("Organization")) return 12;
  if (node.labels.includes("Misunderstanding")) return 11;
  if (node.labels.includes("Secret")) return 11;
  if (node.labels.includes("Identity")) return 10;
  if (node.labels.includes("Item")) return 10;
  if (node.labels.includes("Location")) return 10;
  if (node.labels.includes("Scene")) return 10;
  return 11;
}

// Edge style helper — branches by edge type so BelievesAbout / KnowsSecret
// stand out from the default ScreenplayRelation strokes.
function edgeStyle(
  e: EdgeDTO,
  hi: boolean,
): { color: string; lineWidth: number; dash: number[] } {
  const isResolved = (e.properties.is_resolved as boolean | undefined) ?? false;
  const strength = (e.properties.relation_strength as number | undefined) ?? 3;
  if (e.type === "BelievesAbout") {
    const alpha = isResolved ? 0.4 : 1.0;
    return {
      color: hi ? `rgba(126,58,155,${alpha})` : `rgba(126,58,155,${0.3 * alpha})`,
      lineWidth: 2,
      dash: [6, 3],
    };
  }
  if (e.type === "KnowsSecret") {
    return {
      color: hi ? "rgba(58,30,94,0.95)" : "rgba(58,30,94,0.4)",
      lineWidth: 2.5,
      dash: [],
    };
  }
  // Default ScreenplayRelation
  return {
    color: hi ? "rgba(228,0,43,0.7)" : "rgba(5,5,5,0.14)",
    lineWidth: hi ? Math.max(1.5, strength * 0.4) : 0.8,
    dash: [],
  };
}

// Point-to-line-segment distance for edge hit-testing.
function pointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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
  uuid: string | null;
  source: string;
  target: string;
  type: string;
  kind: string;
  props: Record<string, unknown>;
}

interface SimState {
  nodes: SimNode[];
  edges: SimEdge[];
  drag: { id: string; n: SimNode } | null;
  hover: string | null;
  hoverEdge: string | null;
  // Auto-freeze: the simulation is pre-settled synchronously at mount
  // (see PRESETTLE_TICKS in the seed effect), so we start ``frozen`` and
  // only re-integrate physics while a user is dragging or for a brief
  // anneal after drag-release. ``releaseTicks`` counts down a small
  // number of ticks after pointer-up so released nodes don't fly off.
  frozen: boolean;
  releaseTicks: number;
}

// Force-simulation tuning. Constants are reused for both the synchronous
// pre-settle pass and the runtime drag-anneal so layouts stay consistent.
const REPEL = 1800;
const SPRING = 0.02;
const IDEAL_LEN = 78;
const DAMP = 0.86;
const CENTER = 0.012;

// Pre-settle: number of synchronous physics ticks to run on mount before
// handing off to the rAF render loop. 300 was visually verified as the
// point where layouts converge for our typical 50-200 node graphs; if
// you grow the graph past ~300 nodes, bump this to 500 or introduce a
// cooldown schedule (high damp early, normal late).
const PRESETTLE_TICKS = 300;
// Brief post-drag anneal: number of ticks to keep integrating physics
// after pointer-up so released nodes settle their neighbours instead of
// snapping in place mid-flight.
const RELEASE_ANNEAL_TICKS = 5;

export default function ForceGraphPanel({
  graph,
  selectedUuid,
  onSelect,
  title,
  inkStyle,
  selectedEdgeUuid,
  onSelectEdge,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<SimState | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);
  const selectedRef = useRef<string | null>(selectedUuid);
  selectedRef.current = selectedUuid;
  const selectedEdgeRef = useRef<string | null>(selectedEdgeUuid ?? null);
  selectedEdgeRef.current = selectedEdgeUuid ?? null;

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
      .map((e) => ({
        uuid: e.uuid,
        source: e.source,
        target: e.target,
        type: e.type,
        kind: e.type,
        props: e.properties,
      }));

    // Fast path: if every node carries a baked layout (snapshot from the
    // static-pages build), skip the synchronous presettle entirely. The
    // layout was computed deterministically by `scripts/snapshot_bazong_demo.py`
    // and we just adopt it. Drag still works because wakeSim() unfreezes
    // the simulation when the user grabs a node.
    const allPositioned =
      nodes.length > 0 &&
      graph.nodes.every(
        (n) =>
          typeof n.properties.layout_x === "number" &&
          typeof n.properties.layout_y === "number",
      );

    if (allPositioned) {
      for (let i = 0; i < nodes.length; i++) {
        const src = graph.nodes[i];
        nodes[i].x = src.properties.layout_x as number;
        nodes[i].y = src.properties.layout_y as number;
        nodes[i].vx = 0;
        nodes[i].vy = 0;
      }
      simRef.current = {
        nodes,
        edges,
        drag: null,
        hover: null,
        hoverEdge: null,
        frozen: true,
        releaseTicks: 0,
      };
      return;
    }

    // Seed positions on a jittered ring so the first few ticks don't
    // collapse the whole graph into a single pixel.
    const R = Math.max(120, Math.min(260, nodes.length * 8));
    nodes.forEach((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      n.x = Math.cos(a) * R * (0.6 + Math.random() * 0.4);
      n.y = Math.sin(a) * R * (0.6 + Math.random() * 0.4);
    });

    // Pre-settle the simulation synchronously before the first paint.
    // This converges the layout instantly so the user never sees the
    // jittery "graph melts into shape" animation. After this loop the
    // render loop starts with ``frozen: true``; only drag wakes it.
    const idToNode = new Map(nodes.map((n) => [n.id, n]));
    for (let t = 0; t < PRESETTLE_TICKS; t++) {
      // Repulsion (pairwise).
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
      // Spring.
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
        n.vx -= n.x * CENTER;
        n.vy -= n.y * CENTER;
        n.vx *= DAMP;
        n.vy *= DAMP;
        n.x += n.vx;
        n.y += n.vy;
      }
    }
    // Zero residual velocity so the post-mount frozen state is clean.
    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
    }

    simRef.current = {
      nodes,
      edges,
      drag: null,
      hover: null,
      hoverEdge: null,
      frozen: true,
      releaseTicks: 0,
    };
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
        // Resize only changes the canvas viewport; the pre-settled
        // layout is already centred on (0, 0) so we don't wake the sim.
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
      // We always need the id→node map for rendering even when physics is
      // skipped — declare it outside the freeze gate so the render block
      // below can reach it.
      const idToNode = new Map(nodes.map((n) => [n.id, n]));

      // Freeze gate: physics is pre-settled at mount, so we only re-run
      // it while a node is being dragged or for a brief anneal window
      // after release (RELEASE_ANNEAL_TICKS). Otherwise we just render.
      const integrate = !sim.frozen || drag !== null || sim.releaseTicks > 0;
      if (integrate) {
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

        // Drag keeps the sim awake; release-anneal counts down then
        // re-freezes. We zero residual velocity on freeze so a future
        // wake-up starts clean.
        if (drag) {
          sim.frozen = false;
          sim.releaseTicks = 0;
        } else if (sim.releaseTicks > 0) {
          sim.releaseTicks -= 1;
          if (sim.releaseTicks === 0) {
            sim.frozen = true;
            for (const n of nodes) {
              n.vx = 0;
              n.vy = 0;
            }
          }
        }
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
      const selectedEdge = selectedEdgeRef.current;
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

        // Build a synthetic EdgeDTO-shaped object for edgeStyle (it only
        // touches `type` and `properties`).
        const edgeDTOLike: EdgeDTO = {
          uuid: e.uuid,
          source: e.source,
          target: e.target,
          type: e.type,
          properties: e.props,
        };
        const style = edgeStyle(edgeDTOLike, hi);
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.lineWidth;
        ctx.setLineDash(style.dash);

        // If this edge is selected, give it a brighter halo treatment.
        if (selectedEdge && e.uuid === selectedEdge) {
          ctx.lineWidth = style.lineWidth + 1.5;
        }

        ctx.beginPath();
        ctx.moveTo(cx + a.x, cy + a.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // Slight perpendicular offset keeps related edges readable.
        ctx.quadraticCurveTo(cx + mx + 2, cy + my - 2, cx + b.x, cy + b.y);
        ctx.stroke();
        ctx.setLineDash([]);

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

        // Hover emoji for KnowsSecret edges — surfaces knowledge_source.
        if (sim.hoverEdge && e.uuid === sim.hoverEdge && e.kind === "KnowsSecret") {
          const src = (e.props.knowledge_source as string | undefined) ?? "unknown";
          const emoji =
            src === "witnessed"
              ? "👁️"
              : src === "told_by"
                ? "🗣️"
                : src === "deduced"
                  ? "💭"
                  : src === "born_with"
                    ? "🩸"
                    : "❓";
          ctx.font = "16px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(58,30,94,1)";
          ctx.fillText(emoji, cx + (a.x + b.x) / 2, cy + (a.y + b.y) / 2);
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

  // Pointer handlers — drag nodes, click to select nodes or edges.
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

  const locateEdge = (clientX: number, clientY: number): SimEdge | null => {
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left - rect.width / 2;
    const my = clientY - rect.top - rect.height / 2;
    const idToNode = new Map(sim.nodes.map((n) => [n.id, n]));
    let best: { d: number; ed: SimEdge } | null = null;
    for (const ed of sim.edges) {
      const a = idToNode.get(ed.source);
      const b = idToNode.get(ed.target);
      if (!a || !b) continue;
      const d = pointToSegment(mx, my, a.x, a.y, b.x, b.y);
      if (d < 6 && (!best || d < best.d)) {
        best = { d, ed };
      }
    }
    return best ? best.ed : null;
  };

  // Wake the simulation for a drag interaction. Click-only interactions
  // (selecting a node / edge / background) do not wake the sim — the
  // pre-settled layout is correct, and the next render tick will repaint
  // the highlight halo regardless of the freeze state.
  const wakeSim = () => {
    const sim = simRef.current;
    if (!sim) return;
    sim.frozen = false;
    sim.releaseTicks = 0;
  };

  const onDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    const n = locateNode(ev.clientX, ev.clientY);
    if (n) {
      simRef.current!.drag = { id: n.id, n };
      wakeSim();
      onSelect(n.id);
      onSelectEdge?.(null);
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
      return;
    }
    // No node hit — try edges. Selection-only interactions don't wake
    // the simulation (see wakeSim comment).
    const hitEdge = locateEdge(ev.clientX, ev.clientY);
    if (hitEdge && hitEdge.uuid) {
      onSelectEdge?.(hitEdge.uuid);
      onSelect(null);
      return;
    }
    onSelect(null);
    onSelectEdge?.(null);
  };
  const onMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.drag) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = ev.clientX - rect.left - rect.width / 2;
      const my = ev.clientY - rect.top - rect.height / 2;
      sim.drag.n.x = mx;
      sim.drag.n.y = my;
      return;
    }
    // Hover-state tracking for edge-hover emoji.
    const hovered = locateEdge(ev.clientX, ev.clientY);
    sim.hoverEdge = hovered ? hovered.uuid : null;
  };
  const onUp = () => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.drag) {
      // Released a dragged node — schedule a brief anneal so the
      // released node's neighbours settle around its new position
      // instead of locking instantly mid-flight.
      sim.drag = null;
      sim.releaseTicks = RELEASE_ANNEAL_TICKS;
      sim.frozen = false;
    }
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
