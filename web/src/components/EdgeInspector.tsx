// Right-rail inspector for a selected edge. Mirrors NodeInspector's shape
// (panel, demo banner, FieldsTable, scene-appearance chips) but renders
// edge-specific bits: source→target chips, edge type as the title, quote
// snippets parsed from the JSON-encoded `quotes` property.

import { useMemo, useState } from "react";
import { api } from "../api";
import type { EdgeDTO, GraphDTO, NodeDTO } from "../types";

interface Props {
  projectId: string;
  demo: boolean;
  edge: EdgeDTO;
  graph: GraphDTO;
  onRefresh: () => void;
  onClose: () => void;
  onSelectNode?: (uuid: string) => void;
}

const HIDDEN_EDGE_FIELDS = new Set(["scene_appearances", "quotes", "episodes"]);

function isHiddenEdgeField(key: string): boolean {
  if (key.endsWith("_embedding")) return true;
  if (HIDDEN_EDGE_FIELDS.has(key)) return true;
  return false;
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return v.map((x) => (x === null || x === undefined ? "—" : String(x))).join(", ");
  }
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function sceneTag(n: NodeDTO): string {
  const ep = (n.properties.episode_number ?? n.properties.episode) as
    | number
    | undefined;
  const sc = (n.properties.scene_number ?? n.properties.scene) as
    | number
    | undefined;
  if (typeof ep === "number" && typeof sc === "number") {
    return `S${String(ep).padStart(2, "0")}E${String(sc).padStart(2, "0")}`;
  }
  return n.name ?? n.uuid.slice(0, 8);
}

interface QuoteEntry {
  scene_uuid: string;
  snippet: string;
}

function parseQuotes(raw: unknown): QuoteEntry[] {
  if (!raw) return [];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (q): q is QuoteEntry =>
          q && typeof q === "object" && typeof q.snippet === "string",
      )
      .map((q) => ({
        scene_uuid: typeof q.scene_uuid === "string" ? q.scene_uuid : "",
        snippet: q.snippet,
      }));
  } catch {
    return [];
  }
}

export default function EdgeInspector({
  projectId,
  demo,
  edge,
  graph,
  onRefresh,
  onClose,
  onSelectNode,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllQuotes, setShowAllQuotes] = useState(false);

  const src = graph.nodes.find((n) => n.uuid === edge.source);
  const dst = graph.nodes.find((n) => n.uuid === edge.target);

  const props = edge.properties || {};

  const fieldRows = useMemo<Array<[string, unknown]>>(() => {
    return Object.entries(props).filter(([k]) => !isHiddenEdgeField(k));
  }, [props]);

  const sceneUUIDs = (props.scene_appearances as string[] | undefined) ?? [];
  const sceneTagFor = (uuid: string): string => {
    const n = graph.nodes.find((x) => x.uuid === uuid);
    if (!n) return uuid.slice(0, 8);
    return sceneTag(n);
  };

  const quotes = useMemo(() => parseQuotes(props.quotes), [props.quotes]);
  const visibleQuotes = showAllQuotes ? quotes : quotes.slice(0, 3);
  const hiddenQuoteCount = Math.max(0, quotes.length - 3);

  async function remove() {
    if (demo || !edge.uuid) return;
    if (!confirm(`删除边 "${edge.type}"？`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/projects/${projectId}/edges/${edge.uuid}`);
      onClose();
      onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const Endpoint = ({ node, fallback }: { node: NodeDTO | undefined; fallback: string }) => (
    <span
      className="chip"
      style={{
        cursor: node && onSelectNode ? "pointer" : "default",
      }}
      onClick={() => node && onSelectNode?.(node.uuid)}
      title={node?.labels.join(" · ") ?? fallback}
    >
      {node?.name ?? fallback}
    </span>
  );

  return (
    <aside
      style={{
        width: 340,
        padding: "20px 22px",
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        color: "var(--text)",
      }}
    >
      <div className="row">
        <span className="kicker">边详情</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} className="btn sm ghost">
          关闭
        </button>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <Endpoint node={src} fallback={edge.source.slice(0, 8)} />
          <span style={{ color: "var(--text-muted)" }}>━━▶</span>
          <Endpoint node={dst} fallback={edge.target.slice(0, 8)} />
        </div>
        <div
          style={{
            fontSize: 20,
            color: "var(--text)",
            fontWeight: 700,
            wordBreak: "break-all",
            marginTop: 10,
          }}
        >
          {edge.type}
        </div>
      </div>

      {demo && (
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(253, 203, 110, 0.10)",
            borderLeft: "2px solid #fdcb6e",
            borderRadius: 4,
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          示例项目为只读模式，边编辑不可用。
        </div>
      )}

      {edge.uuid && (
        <InspectorRow k="UUID">
          <span className="mono tiny" style={{ wordBreak: "break-all" }}>
            {edge.uuid}
          </span>
        </InspectorRow>
      )}

      {fieldRows.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            边属性
          </div>
          <FieldsTable fields={fieldRows} />
        </div>
      )}

      {sceneUUIDs.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
            出现于 ({sceneUUIDs.length} 场)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {sceneUUIDs.map((uuid) => (
              <span
                key={uuid}
                className="chip"
                style={{ cursor: onSelectNode ? "pointer" : "default" }}
                onClick={() => onSelectNode?.(uuid)}
                title={uuid}
              >
                {sceneTagFor(uuid)}
              </span>
            ))}
          </div>
        </div>
      )}

      {quotes.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
            原文片段 ({quotes.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleQuotes.map((q, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 10px",
                  background: "rgba(255,255,255,0.04)",
                  borderLeft: "2px solid var(--border-strong)",
                  borderRadius: 4,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "var(--text-dim)",
                }}
              >
                <span
                  className="mono tiny"
                  style={{ color: "var(--text-muted)", marginRight: 6 }}
                >
                  [{q.scene_uuid ? sceneTagFor(q.scene_uuid) : "—"}]
                </span>
                {q.snippet}
              </div>
            ))}
          </div>
          {hiddenQuoteCount > 0 && (
            <button
              className="btn sm ghost"
              style={{ marginTop: 6 }}
              onClick={() => setShowAllQuotes((v) => !v)}
            >
              {showAllQuotes ? "收起" : `展开剩余 ${hiddenQuoteCount} 条`}
            </button>
          )}
        </div>
      )}

      {!demo && edge.uuid && (
        <button
          className="btn sm block danger"
          onClick={remove}
          disabled={busy}
          style={{ marginTop: 4 }}
        >
          删除此边
        </button>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "#fca5a5", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}
    </aside>
  );
}

function InspectorRow({
  k,
  children,
}: {
  k: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="tiny muted" style={{ marginBottom: 4 }}>
        {k}
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{children}</div>
    </div>
  );
}

function FieldsTable({ fields }: { fields: Array<[string, unknown]> }) {
  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <tbody>
        {fields.map(([k, v]) => (
          <tr key={k} style={{ borderBottom: "1px solid var(--border)" }}>
            <td
              style={{
                color: "var(--text-muted)",
                paddingRight: 8,
                paddingTop: 5,
                paddingBottom: 5,
                whiteSpace: "nowrap",
                verticalAlign: "top",
                width: "40%",
              }}
            >
              {k}
            </td>
            <td
              style={{
                color: "var(--text-dim)",
                paddingTop: 5,
                paddingBottom: 5,
                wordBreak: "break-word",
              }}
            >
              {formatScalar(v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
