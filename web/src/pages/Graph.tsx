import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { GraphDTO, NodeDTO } from "../types";
import { useUI } from "../store";
import ForceGraphPanel from "../components/ForceGraphPanel";
import NodeInspector from "../components/NodeInspector";
import FilterPanel from "../components/FilterPanel";
import Chat from "../components/Chat";

function filterGraph(graph: GraphDTO, hidden: Set<string>): GraphDTO {
  if (hidden.size === 0) return graph;
  const visibleNodes = graph.nodes.filter((n) =>
    n.labels.every((l) => !hidden.has(l)),
  );
  const visibleUuids = new Set(visibleNodes.map((n) => n.uuid));
  const visibleEdges = graph.edges.filter(
    (e) => visibleUuids.has(e.source) && visibleUuids.has(e.target),
  );
  return { nodes: visibleNodes, edges: visibleEdges };
}

export default function GraphPage() {
  const pid = useUI((s) => s.projectId);
  const [detail, setDetail] = useState<GraphDTO>({ nodes: [], edges: [] });
  const [hl, setHl] = useState<GraphDTO>({ nodes: [], edges: [] });
  const [selectedDetail, setSelectedDetail] = useState<string | null>(null);
  const [selectedHl, setSelectedHl] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!pid) return;
    setError(null);
    try {
      const [d, h] = await Promise.all([
        api.get<GraphDTO>(`/projects/${pid}/graph?layer=detail&limit=500`),
        api.get<GraphDTO>(`/projects/${pid}/graph?layer=hl&limit=200`),
      ]);
      setDetail(d);
      setHl(h);
    } catch (e) {
      setError(String(e));
    }
  }, [pid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filteredDetail = useMemo(() => filterGraph(detail, hiddenTypes), [detail, hiddenTypes]);
  const filteredHl = useMemo(() => filterGraph(hl, hiddenTypes), [hl, hiddenTypes]);

  const selectedNode: NodeDTO | null = useMemo(() => {
    if (selectedDetail) {
      return detail.nodes.find((n) => n.uuid === selectedDetail) ?? null;
    }
    if (selectedHl) {
      return hl.nodes.find((n) => n.uuid === selectedHl) ?? null;
    }
    return null;
  }, [selectedDetail, selectedHl, detail, hl]);

  if (!pid) return <div className="p-8">先在「项目」页选一个项目。</div>;

  function toggleType(label: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <div className="flex h-full">
      <aside className="w-56 bg-slate-900/50 border-r border-slate-800 p-3 text-sm overflow-auto">
        <div className="font-semibold mb-2">过滤</div>
        <div className="text-xs text-slate-500 mb-1">隐藏类型（对两层都生效）</div>
        <FilterPanel
          nodes={[...detail.nodes, ...hl.nodes]}
          active={hiddenTypes}
          onToggle={toggleType}
        />
        <div className="mt-4">
          <button
            className="w-full bg-slate-800 hover:bg-slate-700 text-xs rounded py-1"
            onClick={refresh}
          >
            重新加载
          </button>
        </div>
        {error && (
          <div className="text-red-400 text-xs mt-3 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </aside>

      <section className="flex-1 flex min-w-0">
        <div className="flex-1 min-w-0 border-r border-slate-800 relative">
          <ForceGraphPanel
            graph={filteredDetail}
            selectedUuid={selectedDetail}
            onSelect={(u) => {
              setSelectedDetail(u);
              setSelectedHl(null);
            }}
            title="详细层"
          />
        </div>
        <div className="flex-1 min-w-0 relative">
          <ForceGraphPanel
            graph={filteredHl}
            selectedUuid={selectedHl}
            onSelect={(u) => {
              setSelectedHl(u);
              setSelectedDetail(null);
            }}
            title="节拍层"
          />
        </div>
      </section>

      {selectedNode && pid && (
        <NodeInspector
          projectId={pid}
          node={selectedNode}
          graph={selectedDetail ? detail : hl}
          onRefresh={refresh}
          onClose={() => {
            setSelectedDetail(null);
            setSelectedHl(null);
          }}
        />
      )}

      <Chat projectId={pid} />
    </div>
  );
}
