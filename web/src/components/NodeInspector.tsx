import { useState } from "react";
import { api } from "../api";
import type { GraphDTO, NodeDTO } from "../types";
import { KIND_ZH, ROLE_ZH } from "../mockdata";

interface Props {
  projectId: string;
  demo: boolean;
  node: NodeDTO;
  graph: GraphDTO;
  onRefresh: () => void;
  onClose: () => void;
}

export default function NodeInspector({
  projectId,
  demo,
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

  const props = node.properties || {};
  const roleCode = props.role_type as string | undefined;
  const age = props.age as number | undefined;
  const tension = props.tension_level as number | undefined;

  async function rename() {
    if (demo) return;
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
    if (demo) return;
    if (!confirm(`删除节点 "${node.name || node.uuid}"？关联的边也会一并删除。`)) return;
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
    if (demo || !edgeTarget || !edgeName) return;
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
  const kind = node.labels.find((l) => KIND_ZH[l]) ?? node.labels[0] ?? "";

  return (
    <aside
      style={{
        width: 320,
        padding: "18px 20px",
        background: "#fff",
        borderLeft: "1px solid var(--divider-strong)",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div className="row">
        <span className="kicker">节点详情</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} className="btn sm ghost">
          关闭
        </button>
      </div>

      <div>
        <div
          style={{
            fontSize: 20,
            color: "var(--ink-900)",
            fontWeight: 700,
            wordBreak: "break-all",
          }}
        >
          {name || node.uuid}
        </div>
        <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: "wrap" }}>
          {kind && <span className="chip">{KIND_ZH[kind] || kind}</span>}
          {roleCode && <span className="chip hot">{ROLE_ZH[roleCode] || roleCode}</span>}
          {typeof age === "number" && age > 0 && <span className="chip">{age} 岁</span>}
          {typeof tension === "number" && (
            <span className="chip hot">张力 {tension}</span>
          )}
        </div>
      </div>

      {demo && (
        <div
          className="tiny muted"
          style={{
            padding: "8px 10px",
            background: "var(--ink-050)",
            borderLeft: "2px solid var(--warn)",
            borderRadius: 0,
          }}
        >
          示例项目为只读模式，节点编辑不可用。
        </div>
      )}

      <InspectorRow k="UUID">
        <span className="mono tiny" style={{ wordBreak: "break-all" }}>
          {node.uuid}
        </span>
      </InspectorRow>
      <InspectorRow k="标签">
        {node.labels.join(" · ") || "—"}
      </InspectorRow>

      {!demo && (
        <div>
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 4 }}>
            重命名
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn sm primary"
              onClick={rename}
              disabled={busy}
            >
              保存
            </button>
          </div>
        </div>
      )}

      <InspectorRow k="属性">
        <pre
          style={{
            background: "var(--ink-050)",
            padding: "8px 10px",
            borderRadius: 0,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--ink-700)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: 0,
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {JSON.stringify(stripEmbeddings(props), null, 2)}
        </pre>
      </InspectorRow>

      {!demo && (
        <div style={{ paddingTop: 8, borderTop: "1px solid var(--hairline)" }}>
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 6 }}>
            新增边 (从本节点出发)
          </div>
          <input
            className="input"
            style={{ marginBottom: 6 }}
            placeholder="关系名，如：认识"
            value={edgeName}
            onChange={(e) => setEdgeName(e.target.value)}
          />
          <select
            className="input"
            style={{ marginBottom: 8 }}
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
            className="btn sm block primary"
            onClick={addEdge}
            disabled={busy || !edgeTarget || !edgeName}
          >
            添加
          </button>
        </div>
      )}

      {!demo && (
        <button
          className="btn sm block danger"
          onClick={remove}
          disabled={busy}
          style={{ marginTop: 4 }}
        >
          删除此节点
        </button>
      )}

      {error && (
        <div className="tiny" style={{ color: "var(--err)", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}
    </aside>
  );
}

function InspectorRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 4 }}>
        {k}
      </div>
      <div style={{ color: "var(--ink-800)", fontSize: 13 }}>{children}</div>
    </div>
  );
}

function stripEmbeddings(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!k.endsWith("_embedding")) out[k] = v;
  }
  return out;
}
