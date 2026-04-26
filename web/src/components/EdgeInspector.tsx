// Right-rail inspector for a selected edge. Mirrors NodeInspector's shape
// (320px panel, demo-mode banner, FieldsTable, scene-appearance chips) but
// renders edge-specific bits: source→target chips, edge type as the title,
// quote snippets parsed from the JSON-encoded `quotes` property.

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
  // Optional — when provided, source/target chips become clickable so users
  // can pivot from the edge into either endpoint's NodeInspector.
  onSelectNode?: (uuid: string) => void;
}

// Edge properties that get their own dedicated section (or are noise) and
// therefore should not appear in the generic FieldsTable.
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

// Compact scene tag (S01E03). Pulls episode/scene off whatever properties
// the backend writes — both `episode_number` and the bare `episode` form
// show up depending on layer.
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

// `quotes` is stored as a JSON-encoded string (Neo4j primitive constraint),
// so we have to parse it. Robust against missing/malformed payloads.
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

  // Generic property rows for the FieldsTable.
  const fieldRows = useMemo<Array<[string, unknown]>>(() => {
    return Object.entries(props).filter(([k]) => !isHiddenEdgeField(k));
  }, [props]);

  // Scene appearances chips. Resolves UUIDs to scene nodes when possible so
  // we can render a real S01E03-style tag; otherwise falls back to short uuid.
  const sceneUUIDs = (props.scene_appearances as string[] | undefined) ?? [];
  const sceneTagFor = (uuid: string): string => {
    const n = graph.nodes.find((x) => x.uuid === uuid);
    if (!n) return uuid.slice(0, 8);
    return sceneTag(n);
  };

  // Quote snippets (JSON-encoded list).
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

  // Tiny endpoint chip — clickable when onSelectNode is provided.
  const Endpoint = ({ node, fallback }: { node: NodeDTO | undefined; fallback: string }) => (
    <span
      className="chip"
      style={{
        cursor: node && onSelectNode ? "pointer" : "default",
        fontSize: 12,
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
          <span style={{ color: "var(--ink-500)" }}>━━▶</span>
          <Endpoint node={dst} fallback={edge.target.slice(0, 8)} />
        </div>
        <div
          style={{
            fontSize: 20,
            color: "var(--ink-900)",
            fontWeight: 700,
            wordBreak: "break-all",
            marginTop: 8,
          }}
        >
          {edge.type}
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
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 4 }}>
            边属性
          </div>
          <FieldsTable fields={fieldRows} />
        </div>
      )}

      {sceneUUIDs.length > 0 && (
        <div>
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 6 }}>
            出现于 ({sceneUUIDs.length} 场)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {sceneUUIDs.map((uuid) => (
              <span
                key={uuid}
                className="chip"
                style={{
                  fontSize: 11,
                  cursor: onSelectNode ? "pointer" : "default",
                }}
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
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 6 }}>
            原文片段 ({quotes.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleQuotes.map((q, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 8px",
                  background: "var(--ink-050)",
                  borderLeft: "2px solid var(--divider-strong)",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--ink-800)",
                }}
              >
                <span
                  className="mono tiny"
                  style={{ color: "var(--ink-500)", marginRight: 6 }}
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
        <div className="tiny" style={{ color: "var(--err)", whiteSpace: "pre-wrap" }}>
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
      <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 4 }}>
        {k}
      </div>
      <div style={{ color: "var(--ink-800)", fontSize: 13 }}>{children}</div>
    </div>
  );
}

// Same shape as NodeInspector's FieldsTable — kept local to avoid coupling
// the two inspectors via a shared module that doesn't yet exist.
function FieldsTable({ fields }: { fields: Array<[string, unknown]> }) {
  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <tbody>
        {fields.map(([k, v]) => (
          <tr key={k} style={{ borderBottom: "1px solid var(--hairline)" }}>
            <td
              style={{
                color: "var(--ink-500)",
                paddingRight: 8,
                paddingTop: 4,
                paddingBottom: 4,
                whiteSpace: "nowrap",
                verticalAlign: "top",
                width: "40%",
              }}
            >
              {k}
            </td>
            <td
              style={{
                color: "var(--ink-800)",
                paddingTop: 4,
                paddingBottom: 4,
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
