// Graph page — dual 3D panels (detail above, beats below), filter rail on
// the left, node OR edge inspector on the right when a selection exists.
//
// Selection rule: at most one of {selectedDetail, selectedHl,
// selectedDetailEdge, selectedHlEdge} is non-null at any time. Picking a node
// clears all edge selections (and the other panel's node selection); picking
// an edge clears all node selections. EdgeInspector wins over NodeInspector
// in render priority — but mutual exclusivity means we never see both.
//
// For demo projects we generate a small graph from the mock data so users
// who haven't ingested anything still see a populated view. Real projects
// fetch from /projects/{id}/graph?layer=...

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DEMO_ONLY } from "../env";
import type { EdgeDTO, GraphDTO, NodeDTO } from "../types";
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

function filterGraph(graph: GraphDTO, hidden: Set<string>): GraphDTO {
  if (hidden.size === 0) return graph;
  const visible = graph.nodes.filter((n) => n.labels.every((l) => !hidden.has(l)));
  const ids = new Set(visible.map((n) => n.uuid));
  return {
    nodes: visible,
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

export default function GraphPage() {
  const project = useUI((s) => s.project);
  const [detail, setDetail] = useState<GraphDTO>({ nodes: [], edges: [] });
  const [hl, setHl] = useState<GraphDTO>({ nodes: [], edges: [] });
  const [selectedDetail, setSelectedDetail] = useState<string | null>(null);
  const [selectedHl, setSelectedHl] = useState<string | null>(null);
  const [selectedDetailEdge, setSelectedDetailEdge] = useState<string | null>(null);
  const [selectedHlEdge, setSelectedHlEdge] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    setError(null);
    if (DEMO_ONLY || project.demo) {
      setDetail(buildMockDetailGraph());
      setHl(buildMockHlGraph());
      return;
    }
    try {
      const [d, h] = await Promise.all([
        api.get<GraphDTO>(`/projects/${project.id}/graph?layer=detail&limit=500`),
        api.get<GraphDTO>(`/projects/${project.id}/graph?layer=hl&limit=200`),
      ]);
      setDetail(d);
      setHl(h);
    } catch (e) {
      setError(String(e));
    }
  }, [project]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filteredDetail = useMemo(
    () => filterGraph(detail, hidden),
    [detail, hidden],
  );
  const filteredHl = useMemo(() => filterGraph(hl, hidden), [hl, hidden]);

  // At most one of these resolves; mutual exclusivity is enforced by the
  // setters below (selecting a node clears all edge state and vice versa).
  const selectedNode: NodeDTO | null = useMemo(() => {
    if (selectedDetail)
      return detail.nodes.find((n) => n.uuid === selectedDetail) ?? null;
    if (selectedHl) return hl.nodes.find((n) => n.uuid === selectedHl) ?? null;
    return null;
  }, [selectedDetail, selectedHl, detail, hl]);

  const selectedEdge: EdgeDTO | null = useMemo(() => {
    if (selectedDetailEdge)
      return detail.edges.find((e) => e.uuid === selectedDetailEdge) ?? null;
    if (selectedHlEdge)
      return hl.edges.find((e) => e.uuid === selectedHlEdge) ?? null;
    return null;
  }, [selectedDetailEdge, selectedHlEdge, detail, hl]);

  const selectedFromDetail =
    selectedDetail !== null || selectedDetailEdge !== null;
  const inspectorGraph = selectedFromDetail ? filteredDetail : filteredHl;

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
  function selectDetailNode(uuid: string | null) {
    setSelectedDetail(uuid);
    if (uuid !== null) {
      setSelectedHl(null);
      setSelectedDetailEdge(null);
      setSelectedHlEdge(null);
    }
  }
  function selectHlNode(uuid: string | null) {
    setSelectedHl(uuid);
    if (uuid !== null) {
      setSelectedDetail(null);
      setSelectedDetailEdge(null);
      setSelectedHlEdge(null);
    }
  }
  function selectDetailEdge(uuid: string | null) {
    setSelectedDetailEdge(uuid);
    if (uuid !== null) {
      setSelectedDetail(null);
      setSelectedHl(null);
      setSelectedHlEdge(null);
    }
  }
  function selectHlEdge(uuid: string | null) {
    setSelectedHlEdge(uuid);
    if (uuid !== null) {
      setSelectedDetail(null);
      setSelectedHl(null);
      setSelectedDetailEdge(null);
    }
  }
  function clearAllSelection() {
    setSelectedDetail(null);
    setSelectedHl(null);
    setSelectedDetailEdge(null);
    setSelectedHlEdge(null);
  }

  // Neighbor / endpoint pivots from the inspector. They land on a node in
  // whichever panel currently owns the inspector context.
  function pivotToNode(uuid: string) {
    if (selectedFromDetail) selectDetailNode(uuid);
    else selectHlNode(uuid);
  }

  const showInspector = selectedNode || selectedEdge;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "188px 1fr" + (showInspector ? " 320px" : ""),
        height: "100%",
        minHeight: 0,
      }}
    >
      <FilterRail
        detailNodes={detail.nodes}
        hlNodes={hl.nodes}
        hidden={hidden}
        onToggle={toggle}
        onRefresh={refresh}
      />
      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", minHeight: 0 }}>
        <div
          style={{
            position: "relative",
            borderBottom: "1px solid var(--divider)",
            minHeight: 0,
          }}
        >
          <ForceGraphPanel
            graph={filteredDetail}
            selectedUuid={selectedDetail}
            onSelect={selectDetailNode}
            selectedEdgeUuid={selectedDetailEdge}
            onSelectEdge={selectDetailEdge}
            title="详细图谱"
            inkStyle={false}
          />
        </div>
        <div style={{ position: "relative", minHeight: 0 }}>
          <ForceGraphPanel
            graph={filteredHl}
            selectedUuid={selectedHl}
            onSelect={selectHlNode}
            selectedEdgeUuid={selectedHlEdge}
            onSelectEdge={selectHlEdge}
            title="高层图谱"
            inkStyle={false}
          />
        </div>
      </div>
      {selectedEdge ? (
        <EdgeInspector
          projectId={project.id}
          demo={DEMO_ONLY || !!project.demo}
          edge={selectedEdge}
          graph={inspectorGraph}
          onRefresh={refresh}
          onClose={clearAllSelection}
          onSelectNode={pivotToNode}
        />
      ) : selectedNode ? (
        <NodeInspector
          projectId={project.id}
          demo={DEMO_ONLY || !!project.demo}
          node={selectedNode}
          graph={inspectorGraph}
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
