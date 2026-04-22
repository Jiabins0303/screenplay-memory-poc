import { useState } from "react";
import { api } from "../api";
import type { GraphDTO, NodeDTO } from "../types";

interface Props {
  projectId: string;
  node: NodeDTO;
  graph: GraphDTO;
  onRefresh: () => void;
  onClose: () => void;
}

export default function NodeInspector({
  projectId,
  node,
  graph,
  onRefresh,
  onClose,
}: Props) {
  const [name, setName] = useState(node.name ?? "");
  const [edgeTarget, setEdgeTarget] = useState("");
  const [edgeName, setEdgeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rename() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/projects/${projectId}/nodes/${node.uuid}`, { name });
      onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`删除节点 "${node.name || node.uuid}"？关联的边也会一并删除。`))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/projects/${projectId}/nodes/${node.uuid}`);
      onClose();
      onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addEdge() {
    if (!edgeTarget || !edgeName) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/edges`, {
        source_uuid: node.uuid,
        target_uuid: edgeTarget,
        name: edgeName,
        fact: "",
      });
      setEdgeTarget("");
      setEdgeName("");
      onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const otherNodes = graph.nodes.filter((n) => n.uuid !== node.uuid);

  return (
    <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col overflow-auto">
      <div className="flex items-center p-3 border-b border-slate-800">
        <div className="font-semibold text-sm">节点详情</div>
        <button className="ml-auto text-slate-400 text-sm" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="p-3 space-y-3 text-sm">
        <div>
          <div className="text-xs text-slate-500 mb-1">UUID</div>
          <div className="font-mono text-xs break-all">{node.uuid}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">标签</div>
          <div>{node.labels.join(", ") || "—"}</div>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">名称</div>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="bg-sky-600 hover:bg-sky-500 px-3 rounded text-sm"
              onClick={rename}
              disabled={busy}
            >
              保存
            </button>
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">属性</div>
          <pre className="bg-slate-950 border border-slate-800 rounded p-2 text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(node.properties, null, 2)}
          </pre>
        </div>

        <div className="pt-2 border-t border-slate-800">
          <div className="text-xs text-slate-500 mb-1">新增边 (从本节点出发)</div>
          <input
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 mb-1"
            placeholder="关系名，如: 认识"
            value={edgeName}
            onChange={(e) => setEdgeName(e.target.value)}
          />
          <select
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 mb-2"
            value={edgeTarget}
            onChange={(e) => setEdgeTarget(e.target.value)}
          >
            <option value="">-- 选择目标节点 --</option>
            {otherNodes.map((n) => (
              <option key={n.uuid} value={n.uuid}>
                {(n.name || n.uuid) + " (" + (n.labels[0] ?? "Entity") + ")"}
              </option>
            ))}
          </select>
          <button
            className="w-full bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-1 text-sm"
            onClick={addEdge}
            disabled={busy || !edgeTarget || !edgeName}
          >
            添加
          </button>
        </div>

        <button
          className="w-full bg-red-600 hover:bg-red-500 rounded px-3 py-1.5 text-sm mt-2"
          onClick={remove}
          disabled={busy}
        >
          删除此节点
        </button>

        {error && <div className="text-red-400 text-xs whitespace-pre-wrap">{error}</div>}
      </div>
    </aside>
  );
}
