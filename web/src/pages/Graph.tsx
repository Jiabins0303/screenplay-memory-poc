// Graph page — single 3D panel switched by a tab bar (detail / HL / bridge).
//
// Selection rule: at most one of {selectedNodeUuid, selectedEdgeUuid} is
// non-null at any time. Picking a node clears edge selection and vice versa.
// Switching tabs clears both. EdgeInspector wins over NodeInspector in render
// priority — but mutual exclusivity means we never see both.
//
// All graph data is fetched via /projects/{id}/graph?layer=... — in static
// DEMO_ONLY mode, that fetch is intercepted in api.ts and served from the
// pre-baked snapshot in mockdata.bazong.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DEMO_ONLY } from "../env";
import type { EdgeDTO, GraphDTO, Layer, NodeDTO } from "../types";
import { useUI } from "../store";
import ForceGraphPanel from "../components/ForceGraphPanel";
import FilterRail from "../components/FilterPanel";
import NodeInspector from "../components/NodeInspector";
import EdgeInspector from "../components/EdgeInspector";

function filterGraph(graph: GraphDTO, hidden: Set<string>): GraphDTO {
  if (hidden.size === 0) return graph;
  const visible = graph.nodes.filter((n) => n.labels.every((l) => !hidden.has(l)));
  const ids = new Set(visible.map((n) => n.uuid));
  return {
    nodes: visible,
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

const LAYER_TITLE: Record<Layer, string> = {
  detail: "详细图谱",
  hl: "节拍图谱",
  bridge: "桥接视图",
};

const LAYER_LIMIT: Record<Layer, number> = {
  detail: 500,
  hl: 200,
  bridge: 500,
};

export default function GraphPage() {
  const project = useUI((s) => s.project);
  const [layer, setLayer] = useState<Layer>("detail");
  const [graph, setGraph] = useState<GraphDTO>({ nodes: [], edges: [] });
  const [selectedNodeUuid, setSelectedNodeUuid] = useState<string | null>(null);
  const [selectedEdgeUuid, setSelectedEdgeUuid] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    setError(null);
    try {
      const g = await api.get<GraphDTO>(
        `/projects/${project.id}/graph?layer=${layer}&limit=${LAYER_LIMIT[layer]}`,
      );
      setGraph(g);
    } catch (e) {
      setError(String(e));
    }
  }, [project, layer]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clear any selection when the layer changes — uuids are layer-scoped, so
  // a stale uuid from a previous tab would silently miss in the new graph.
  useEffect(() => {
    setSelectedNodeUuid(null);
    setSelectedEdgeUuid(null);
  }, [layer]);

  const filtered = useMemo(
    () => filterGraph(graph, hidden),
    [graph, hidden],
  );

  const selectedNode: NodeDTO | null = useMemo(() => {
    if (!selectedNodeUuid) return null;
    return graph.nodes.find((n) => n.uuid === selectedNodeUuid) ?? null;
  }, [selectedNodeUuid, graph]);

  const selectedEdge: EdgeDTO | null = useMemo(() => {
    if (!selectedEdgeUuid) return null;
    return graph.edges.find((e) => e.uuid === selectedEdgeUuid) ?? null;
  }, [selectedEdgeUuid, graph]);

  if (!project) {
    return (
      <div className="graph-dark" style={{ padding: 40, color: "var(--text-muted)", background: "var(--bg)", minHeight: "100%" }}>
        先选择或新建项目。
      </div>
    );
  }

  function toggle(label: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  // Selection helpers — every entry point goes through these so the
  // mutual-exclusivity invariant is enforced in one place.
  function selectNode(uuid: string | null) {
    setSelectedNodeUuid(uuid);
    if (uuid !== null) setSelectedEdgeUuid(null);
  }
  function selectEdge(uuid: string | null) {
    setSelectedEdgeUuid(uuid);
    if (uuid !== null) setSelectedNodeUuid(null);
  }
  function clearAllSelection() {
    setSelectedNodeUuid(null);
    setSelectedEdgeUuid(null);
  }

  // Neighbor / endpoint pivot from the inspector — always lands on a node in
  // the current panel since there is only one panel.
  function pivotToNode(uuid: string) {
    selectNode(uuid);
  }

  const showInspector = selectedNode || selectedEdge;

  return (
    <div
      className="graph-dark"
      style={{
        display: "grid",
        // ``minmax(0, 1fr)`` instead of bare ``1fr`` is the load-bearing
        // bit: grid items default to ``min-width: auto`` which expands to
        // the content's intrinsic size. Our middle column hosts a canvas
        // with ``width:100%``, which under bare ``1fr`` blew the column
        // out to the canvas's natural width and pushed the third (320px
        // inspector) column off-screen — selecting a node looked like a
        // no-op even though state was updating. ``minmax(0, …)`` lets
        // the track shrink so the inspector column fits.
        gridTemplateColumns:
          "208px minmax(0, 1fr)" + (showInspector ? " 340px" : ""),
        height: "100%",
        minHeight: 0,
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <FilterRail
        detailNodes={layer === "detail" ? graph.nodes : []}
        hlNodes={layer === "hl" || layer === "bridge" ? graph.nodes : []}
        hidden={hidden}
        onToggle={toggle}
        onRefresh={refresh}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
          background: "var(--bg)",
        }}
      >
        {/* Glass-pill layer switcher floats above the canvas (top-center). */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 3,
            display: "inline-flex",
            padding: 4,
            gap: 2,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          {(["detail", "hl", "bridge"] as Layer[]).map((L) => {
            const active = layer === L;
            return (
              <button
                key={L}
                onClick={() => setLayer(L)}
                style={{
                  padding: "6px 14px",
                  background: active ? "rgba(255,255,255,0.14)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  fontWeight: active ? 600 : 500,
                  fontSize: 12,
                  cursor: "pointer",
                  border: "none",
                  borderRadius: 999,
                  transition: "background .15s, color .15s",
                  letterSpacing: 0.3,
                }}
              >
                {LAYER_TITLE[L]}
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    color: active ? "var(--text-dim)" : "var(--text-muted)",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {active ? graph.nodes.length : 0}·{active ? graph.edges.length : 0}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <ForceGraphPanel
            graph={filtered}
            selectedUuid={selectedNodeUuid}
            onSelect={selectNode}
            selectedEdgeUuid={selectedEdgeUuid}
            onSelectEdge={selectEdge}
            title={LAYER_TITLE[layer]}
            inkStyle={false}
          />
        </div>
      </div>
      {selectedEdge ? (
        <EdgeInspector
          projectId={project.id}
          demo={DEMO_ONLY || !!project.demo}
          edge={selectedEdge}
          graph={filtered}
          onRefresh={refresh}
          onClose={clearAllSelection}
          onSelectNode={pivotToNode}
        />
      ) : selectedNode ? (
        <NodeInspector
          projectId={project.id}
          demo={DEMO_ONLY || !!project.demo}
          node={selectedNode}
          graph={filtered}
          onRefresh={refresh}
          onClose={clearAllSelection}
          onSelectNeighbor={pivotToNode}
        />
      ) : null}
      {error && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: 232,
            color: "#fca5a5",
            fontSize: 12,
            background: "var(--surface-strong)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(252,165,165,0.35)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
