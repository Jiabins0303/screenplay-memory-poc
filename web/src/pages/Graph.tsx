// Graph page — single 3D panel switched by a tab bar (detail / HL / bridge).
//
// Selection rule: at most one of {selectedNodeUuid, selectedEdgeUuid} is
// non-null at any time. Picking a node clears edge selection and vice versa.
// Switching tabs clears both. EdgeInspector wins over NodeInspector in render
// priority — but mutual exclusivity means we never see both.
//
// For demo projects we generate a small graph from the mock data so users
// who haven't ingested anything still see a populated view. Real projects
// fetch from /projects/{id}/graph?layer=...

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DEMO_ONLY } from "../env";
import type { EdgeDTO, GraphDTO, Layer, NodeDTO } from "../types";
import { useUI } from "../store";
import {
  MOCK_BEATS,
  MOCK_CHARACTERS,
  MOCK_SCENES,
} from "../mockdata";
import ForceGraphPanel from "../components/ForceGraphPanel";
import FilterRail from "../components/FilterPanel";
import NodeInspector from "../components/NodeInspector";
import EdgeInspector from "../components/EdgeInspector";

function buildMockDetailGraph(): GraphDTO {
  const nodes: NodeDTO[] = [];
  const edges: GraphDTO["edges"] = [];
  for (const c of MOCK_CHARACTERS) {
    nodes.push({
      uuid: c.id,
      name: c.name,
      labels: ["Character"],
      properties: { role_type: c.role, age: c.age, note: c.note },
    });
  }
  for (const s of MOCK_SCENES) {
    nodes.push({
      uuid: s.id,
      name: `${s.ep}·${s.sc} ${s.title}`,
      labels: ["Scene"],
      properties: { episode_number: s.ep, scene_number: s.sc, location: s.loc },
    });
    for (const cid of s.present) {
      edges.push({ uuid: `${cid}-${s.id}`, source: cid, target: s.id, type: "PRESENT_IN", properties: {} });
    }
  }
  const pair = (a: string, b: string, type: string) =>
    edges.push({ uuid: `${a}-${b}-${type}`, source: a, target: b, type, properties: {} });
  pair("c-zhangwei", "c-lijing", "KNOWS");
  pair("c-zhouyajing", "c-lijing", "母女");
  pair("c-chenma", "c-zhouyajing", "故交");
  pair("c-yangshu", "c-lijingbirth", "接生");
  pair("c-lijingbirth", "c-lijing", "生母");
  return { nodes, edges };
}

function buildMockHlGraph(): GraphDTO {
  const nodes: NodeDTO[] = [];
  const edges: GraphDTO["edges"] = [];
  for (const b of MOCK_BEATS) {
    nodes.push({
      uuid: b.id,
      name: b.label,
      labels: ["Beat"],
      properties: { beat_type: b.type, tension_level: b.tension, description: b.desc },
    });
  }
  for (let i = 0; i < MOCK_BEATS.length - 1; i++) {
    edges.push({
      uuid: `${MOCK_BEATS[i].id}-${MOCK_BEATS[i + 1].id}`,
      source: MOCK_BEATS[i].id,
      target: MOCK_BEATS[i + 1].id,
      type: "FOLLOWS",
      properties: {},
    });
  }
  nodes.push({ uuid: "a-lijing", name: "李静 · 弧光", labels: ["Arc"], properties: {} });
  nodes.push({ uuid: "t-identity", name: "身份", labels: ["Theme"], properties: {} });
  nodes.push({ uuid: "t-truth", name: "真相", labels: ["Theme"], properties: {} });
  for (const bid of ["b-inciting", "b-discovery", "b-revelation", "b-climax", "b-resolution", "b-reconciliation"]) {
    edges.push({ uuid: `${bid}-arc`, source: bid, target: "a-lijing", type: "BELONGS_TO", properties: {} });
  }
  edges.push({ uuid: "a-id", source: "a-lijing", target: "t-identity", type: "EMBODIES", properties: {} });
  edges.push({ uuid: "b-rev-t", source: "b-revelation", target: "t-truth", type: "EMBODIES", properties: {} });
  return { nodes, edges };
}

// Cross-layer mock: take the Beats from the HL mock and connect them to a
// handful of Scenes via COVERS edges. Real bridge data may come back empty
// when ``attach_beats_to_scenes`` produced no bridges yet — that's expected.
function buildMockBridgeGraph(): GraphDTO {
  const nodes: NodeDTO[] = [];
  const edges: GraphDTO["edges"] = [];
  for (const b of MOCK_BEATS) {
    nodes.push({
      uuid: b.id,
      name: b.label,
      labels: ["Beat"],
      properties: { beat_type: b.type, tension_level: b.tension },
    });
  }
  for (const s of MOCK_SCENES) {
    nodes.push({
      uuid: s.id,
      name: `${s.ep}·${s.sc} ${s.title}`,
      labels: ["Scene"],
      properties: { episode_number: s.ep, scene_number: s.sc, location: s.loc },
    });
  }
  // A few illustrative COVERS edges so the bridge tab isn't empty in demo mode.
  const covers: Array<[string, string]> = [
    ["b-inciting", MOCK_SCENES[0]?.id ?? ""],
    ["b-discovery", MOCK_SCENES[1]?.id ?? ""],
    ["b-revelation", MOCK_SCENES[2]?.id ?? ""],
    ["b-climax", MOCK_SCENES[Math.min(3, MOCK_SCENES.length - 1)]?.id ?? ""],
    ["b-resolution", MOCK_SCENES[MOCK_SCENES.length - 1]?.id ?? ""],
  ];
  for (const [bid, sid] of covers) {
    if (!sid) continue;
    edges.push({ uuid: `${bid}-covers-${sid}`, source: bid, target: sid, type: "COVERS", properties: {} });
  }
  return { nodes, edges };
}

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
    if (DEMO_ONLY || project.demo) {
      if (layer === "detail") setGraph(buildMockDetailGraph());
      else if (layer === "hl") setGraph(buildMockHlGraph());
      else setGraph(buildMockBridgeGraph());
      return;
    }
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
    return <div style={{ padding: 40, color: "var(--ink-500)" }}>先选择或新建项目。</div>;
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
          "188px minmax(0, 1fr)" + (showInspector ? " 320px" : ""),
        height: "100%",
        minHeight: 0,
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
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--divider)",
            background: "#fff",
            flexShrink: 0,
          }}
        >
          {(["detail", "hl", "bridge"] as Layer[]).map((L) => {
            const active = layer === L;
            return (
              <button
                key={L}
                onClick={() => setLayer(L)}
                style={{
                  padding: "10px 18px",
                  background: active ? "var(--ink-000)" : "transparent",
                  color: active ? "var(--char-500)" : "var(--ink-600)",
                  fontWeight: active ? 700 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                  border: "none",
                  borderBottom: active
                    ? "2px solid var(--char-500)"
                    : "2px solid transparent",
                }}
              >
                {LAYER_TITLE[L]}
                <span className="tiny muted" style={{ marginLeft: 6 }}>
                  · {active ? graph.nodes.length : 0} 节点 · {active ? graph.edges.length : 0} 边
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
            bottom: 70,
            left: 208,
            color: "var(--err)",
            fontSize: 12,
            background: "var(--ink-100)",
            padding: "6px 10px",
            borderRadius: 0,
            border: "1px solid var(--divider-strong)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
