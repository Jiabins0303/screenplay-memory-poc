import { useEffect, useMemo, useRef } from "react";
import ForceGraph3D from "3d-force-graph";
import type { EdgeDTO, NodeDTO } from "../types";

interface Props {
  graph: { nodes: NodeDTO[]; edges: EdgeDTO[] };
  selectedUuid: string | null;
  onSelect: (uuid: string | null) => void;
  title: string;
}

// Coarse label → color map. "Entity" fallback if nothing specific matches.
// Generated deterministically so the same node type gets the same hue
// across both panels, making cross-layer comparison easier.
const LABEL_COLORS: Record<string, string> = {
  Character: "#60a5fa",
  Scene: "#f97316",
  PlotEvent: "#facc15",
  Beat: "#f472b6",
  Arc: "#34d399",
  Theme: "#c084fc",
  Project: "#94a3b8",
  Entity: "#cbd5e1",
};

function nodeColor(node: NodeDTO): string {
  for (const label of node.labels) {
    if (LABEL_COLORS[label]) return LABEL_COLORS[label];
  }
  return LABEL_COLORS.Entity;
}

export default function ForceGraphPanel({ graph, selectedUuid, onSelect, title }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Using `any` is a deliberate concession — 3d-force-graph's types don't
  // expose the chainable API surface we need, and maintaining our own
  // declaration file would add more upkeep than it saves for a demo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  // Build adjacency once per graph for fast neighbor lookups when
  // highlighting the selected node.
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

  useEffect(() => {
    if (!mountRef.current) return;
    // Cast through `any` because 3d-force-graph's published d.ts treats
    // the default export as a class, but the actual factory is curry
    // style (`ForceGraph3D()(element)`). The wrapping is well-tested
    // upstream; we lose some IDE help in return for not maintaining a
    // local declaration file.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory = ForceGraph3D as unknown as (...a: unknown[]) => any;
    const fg = factory()(mountRef.current)
      .backgroundColor("#020617")
      .nodeLabel((n: { name?: string; id?: string }) => n.name || n.id || "")
      .onNodeClick((n: { id?: string }) => onSelect(n.id ? String(n.id) : null))
      .onBackgroundClick(() => onSelect(null))
      .linkDirectionalArrowLength(2)
      .linkDirectionalArrowRelPos(0.95)
      .linkOpacity(0.5)
      .cooldownTicks(120);
    fgRef.current = fg;
    return () => {
      if (mountRef.current) mountRef.current.innerHTML = "";
      fgRef.current = null;
    };
  }, [onSelect]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const nodes = graph.nodes.map((n) => ({
      id: n.uuid,
      name: n.name || n.uuid,
      labels: n.labels,
      _dto: n,
    }));
    const links = graph.edges
      .filter((e) => e.source && e.target)
      .map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        _dto: e,
      }));

    fg.graphData({ nodes, links });

    const highlightSet = selectedUuid
      ? new Set<string>([selectedUuid, ...(neighborIndex.get(selectedUuid) ?? [])])
      : null;

    fg.nodeColor((n: { id: string; _dto: NodeDTO }) => {
      const base = nodeColor(n._dto);
      if (!highlightSet) return base;
      return highlightSet.has(n.id) ? base : "#1e293b";
    })
      .nodeVal((n: { _dto: NodeDTO }) => {
        // HL beats have tension_level — scale node by it so the most
        // dramatic beats visibly dominate the panel.
        const t = (n._dto.properties.tension_level as number | undefined) ?? 3;
        const base = 1 + Math.min(10, Math.max(1, t)) * 0.5;
        return selectedUuid && n._dto.uuid === selectedUuid ? base * 1.8 : base;
      })
      .linkColor((l: { source: string | { id: string }; target: string | { id: string } }) => {
        if (!highlightSet) return "#475569";
        const src = typeof l.source === "string" ? l.source : l.source.id;
        const tgt = typeof l.target === "string" ? l.target : l.target.id;
        return highlightSet.has(src) && highlightSet.has(tgt) ? "#38bdf8" : "#1e293b";
      });
  }, [graph, selectedUuid, neighborIndex]);

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-2 left-3 text-xs text-slate-400 z-10 pointer-events-none">
        {title} · {graph.nodes.length} 节点 / {graph.edges.length} 边
      </div>
      <div ref={mountRef} className="w-full h-full" />
    </div>
  );
}
