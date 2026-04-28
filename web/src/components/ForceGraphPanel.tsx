// 3D knowledge-graph view, UniMem-style.
//
// Wraps `react-force-graph-3d` (three.js) with our DTO adapter.
// - Background: solid #0a0a0a
// - Nodes: spheres colored by entity-category (5 UniMem groupings, see graphTheme.ts)
// - Links: thin pale-blue with one drifting directional particle
// - Selection: highlights the picked node (white) + dims non-neighbors
// - Baked layout: when nodes carry layout_x/layout_y from the demo snapshot,
//   they're seeded into the 3D space at z=0 then released after first paint
//   so the user can drag and physics gives the scene a hint of depth.
//
// Prop interface is unchanged from the previous 2D canvas implementation
// so Graph.tsx call site keeps compiling. `inkStyle` is accepted but ignored.

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import type { EdgeDTO, NodeDTO } from "../types";
import {
  CATEGORY_COLOR,
  LINK,
  SCENE,
  categoryFor,
  sizeFor,
  type Category,
} from "../lib/graphTheme";

interface Props {
  graph: { nodes: NodeDTO[]; edges: EdgeDTO[] };
  selectedUuid: string | null;
  onSelect: (uuid: string | null) => void;
  title: string;
  inkStyle?: boolean;
  selectedEdgeUuid?: string | null;
  onSelectEdge?: (uuid: string | null) => void;
}

interface NodeObj {
  id: string;
  name: string;
  labels: string[];
  category: Category;
  val: number;
  baseColor: string;
  // Position seeds from baked layout (released after first paint).
  fx?: number;
  fy?: number;
  fz?: number;
  // Mutated by react-force-graph-3d as physics runs.
  x?: number;
  y?: number;
  z?: number;
}

interface LinkObj {
  source: string | NodeObj;
  target: string | NodeObj;
  uuid: string | null;
  type: string;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function endpointId(end: string | NodeObj): string {
  return typeof end === "string" ? end : end.id;
}

export default function ForceGraphPanel({
  graph,
  selectedUuid,
  onSelect,
  title,
  selectedEdgeUuid,
  onSelectEdge,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // ForceGraph3D ref is generic over node/link shapes; we only need
  // refresh() so a permissive ref type keeps the call site readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Container resize → ForceGraph3D width/height props. We can't let the
  // library default to window size because the panel sits inside a CSS
  // grid with a fixed inspector column; window-sized canvas pushes layout.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the {nodes, links} shape react-force-graph-3d wants. Memoized on
  // graph identity so scene/material rebuild only happens when the dataset
  // actually changes (hover & selection do not retrigger this).
  const data = useMemo(() => {
    const nodes: NodeObj[] = graph.nodes.map((n) => {
      const cat = categoryFor(n);
      const baked =
        typeof n.properties.layout_x === "number" &&
        typeof n.properties.layout_y === "number";
      const node: NodeObj = {
        id: n.uuid,
        name: n.name ?? n.uuid.slice(0, 8),
        labels: n.labels,
        category: cat,
        val: sizeFor(n),
        baseColor: CATEGORY_COLOR[cat],
      };
      if (baked) {
        node.fx = n.properties.layout_x as number;
        node.fy = n.properties.layout_y as number;
        node.fz = 0;
      }
      return node;
    });
    const ids = new Set(nodes.map((n) => n.id));
    const links: LinkObj[] = graph.edges
      .filter((e) => e.source && e.target && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        uuid: e.uuid,
        type: e.type,
      }));
    return { nodes, links };
  }, [graph]);

  // After the baked seed paints, release fx/fy/fz so drag works and so 3D
  // physics relaxes z slightly (the demo positions are 2D — leaving every
  // node pinned at z=0 looks flat). 600ms is long enough for the first
  // tick to render the seeded layout.
  useEffect(() => {
    const t = setTimeout(() => {
      let dirty = false;
      for (const n of data.nodes) {
        if (n.fx !== undefined || n.fy !== undefined || n.fz !== undefined) {
          n.fx = undefined;
          n.fy = undefined;
          n.fz = undefined;
          dirty = true;
        }
      }
      if (dirty) fgRef.current?.refresh?.();
    }, 600);
    return () => clearTimeout(t);
  }, [data]);

  // 1-hop neighbor index drives selection-based dimming (highlight the
  // selected node + its neighbors, dim everything else).
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

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor={SCENE.background}
          showNavInfo={false}
          nodeRelSize={4}
          nodeVal={(n: NodeObj) => n.val}
          nodeColor={(n: NodeObj) => {
            if (!selectedUuid) return n.baseColor;
            if (n.id === selectedUuid) return "#ffffff";
            const inFocus =
              n.id === selectedUuid ||
              !!neighborIndex.get(selectedUuid)?.has(n.id);
            return inFocus ? n.baseColor : withAlpha(n.baseColor, 0.18);
          }}
          nodeOpacity={0.92}
          nodeLabel={(n: NodeObj) => n.name}
          linkColor={(l: LinkObj) => {
            if (!selectedUuid) return LINK.color;
            const a = endpointId(l.source);
            const b = endpointId(l.target);
            const touchesSel = a === selectedUuid || b === selectedUuid;
            return touchesSel ? "rgba(180,200,255,0.85)" : "rgba(180,200,255,0.08)";
          }}
          linkWidth={(l: LinkObj) =>
            l.uuid && l.uuid === selectedEdgeUuid ? 3 : LINK.width
          }
          linkOpacity={LINK.opacity}
          linkDirectionalParticles={LINK.particles}
          linkDirectionalParticleWidth={LINK.particleWidth}
          linkDirectionalParticleSpeed={LINK.particleSpeed}
          linkDirectionalParticleColor={() => LINK.particleColor}
          onNodeClick={(n: NodeObj) => {
            onSelect(n.id);
            onSelectEdge?.(null);
          }}
          onLinkClick={(l: LinkObj) => {
            if (l.uuid) {
              onSelectEdge?.(l.uuid);
              onSelect(null);
            }
          }}
          onBackgroundClick={() => {
            onSelect(null);
            onSelectEdge?.(null);
          }}
          cooldownTicks={120}
        />
      )}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 16,
          fontWeight: 600,
          color: "rgba(255,255,255,0.85)",
          fontSize: 13,
          pointerEvents: "none",
          zIndex: 2,
          letterSpacing: 0.4,
        }}
      >
        <span className="mono" style={{ color: "#74b9ff", marginRight: 8 }}>
          {title === "详细图谱" ? "04A" : title === "节拍图谱" ? "04B" : "04C"}
        </span>
        {title}
      </div>
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 18,
          fontSize: 11,
          color: "rgba(255,255,255,0.55)",
          pointerEvents: "none",
          zIndex: 2,
          letterSpacing: 0.3,
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {graph.nodes.length} 节点 · {graph.edges.length} 关系
      </div>
    </div>
  );
}
