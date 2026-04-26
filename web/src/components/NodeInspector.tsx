import { useMemo, useState } from "react";
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
  // Optional — Graph.tsx wires this in Phase 13. When provided, neighbor chips
  // become clickable and navigate the inspector to the chosen neighbor.
  onSelectNeighbor?: (uuid: string) => void;
}

// Same KIND→CSS-var palette ForceGraphPanel uses, kept local so this component
// stays self-contained (no shared module yet, and importing the panel just for
// a constant table would be overkill).
const KIND_COLOR_VARS: Record<string, string> = {
  Character: "--char-500",
  Identity: "--ident-500",
  Family: "--family-500",
  Organization: "--org-500",
  Location: "--loc-500",
  Item: "--item-500",
  Misunderstanding: "--mis-500",
  Secret: "--secret-500",
  Scene: "--scene-500",
  PlotEvent: "--event-500",
  Beat: "--beat-500",
  Arc: "--arc-500",
  Theme: "--theme-500",
  Trope: "--trope-500",
};

const GENERIC_LABELS = new Set(["Entity", "Episodic"]);

// Picks the CSS var for a node's primary kind label. Falls back to the muted
// ink token when the labels are all generic (Entity / Episodic) or unknown.
function nodeColorVar(node: NodeDTO): string {
  for (const label of node.labels) {
    if (GENERIC_LABELS.has(label)) continue;
    const v = KIND_COLOR_VARS[label];
    if (v) return v;
  }
  return "--ink-300";
}

// Fields hidden from the generic FieldsTable. Embeddings are noisy, and
// scene_appearances / quotes get their own dedicated sections.
const HIDDEN_FIELD_PREFIXES = ["_"]; // intentionally empty-ish; keep for future
const HIDDEN_FIELDS = new Set(["scene_appearances", "quotes"]);

function isHiddenField(key: string): boolean {
  if (key.endsWith("_embedding")) return true;
  if (HIDDEN_FIELDS.has(key)) return true;
  for (const p of HIDDEN_FIELD_PREFIXES) {
    if (p && key.startsWith(p)) return true;
  }
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

// Renders a Scene node's compact tag like S01E03.
function sceneTag(n: NodeDTO): string {
  const ep = (n.properties.episode ?? n.properties.episode_number) as number | undefined;
  const sc = (n.properties.scene ?? n.properties.scene_number) as number | undefined;
  if (typeof ep === "number" && typeof sc === "number") {
    return `S${String(ep).padStart(2, "0")}E${String(sc).padStart(2, "0")}`;
  }
  return n.name ?? n.uuid.slice(0, 8);
}

export default function NodeInspector({
  projectId,
  demo,
  node,
  graph,
  onRefresh,
  onClose,
  onSelectNeighbor,
}: Props) {
  const [name, setName] = useState(node.name ?? "");
  const [edgeTarget, setEdgeTarget] = useState("");
  const [edgeName, setEdgeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllScenes, setShowAllScenes] = useState(false);

  const props = node.properties || {};
  const roleCode = props.role_type as string | undefined;
  const age = props.age as number | undefined;
  const tension = props.tension_level as number | undefined;
  const statusTags = (props.status_tags as unknown[] | undefined) ?? [];
  const severity = props.severity as number | undefined;
  const isReal = props.is_real as boolean | undefined; // for Identity nodes

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

  // 1-hop neighbors (deduped). We don't care about edge direction here —
  // the inspector just needs "who is connected to me".
  const neighbors = useMemo(() => {
    const ns: NodeDTO[] = [];
    const seen = new Set<string>();
    for (const e of graph.edges) {
      let otherId: string | null = null;
      if (e.source === node.uuid) otherId = e.target;
      else if (e.target === node.uuid) otherId = e.source;
      if (otherId && !seen.has(otherId)) {
        seen.add(otherId);
        const other = graph.nodes.find((n) => n.uuid === otherId);
        if (other) ns.push(other);
      }
    }
    return ns;
  }, [graph, node.uuid]);

  // Identity neighbors (Character-only). Surfaced separately because they're
  // the most useful at-a-glance signal for protagonists in this drama type.
  const identityNeighbors = useMemo(() => {
    if (!node.labels.includes("Character")) return [];
    return neighbors.filter((n) => n.labels.includes("Identity"));
  }, [neighbors, node.labels]);

  // Generic neighbors = everyone else, so the same node isn't shown twice.
  const genericNeighbors = useMemo(() => {
    if (identityNeighbors.length === 0) return neighbors;
    const idSet = new Set(identityNeighbors.map((n) => n.uuid));
    return neighbors.filter((n) => !idSet.has(n.uuid));
  }, [neighbors, identityNeighbors]);

  // Scene appearances list — read off the property the backend writes during
  // post-ingest indexing (queries/scene_index.py).
  const sceneUUIDs = (props.scene_appearances as string[] | undefined) ?? [];
  const sceneNodes = useMemo(() => {
    const out: NodeDTO[] = [];
    for (const u of sceneUUIDs) {
      const s = graph.nodes.find((n) => n.uuid === u);
      if (s) out.push(s);
    }
    return out;
  }, [sceneUUIDs, graph]);
  const visibleScenes = showAllScenes ? sceneNodes : sceneNodes.slice(0, 8);
  const hiddenSceneCount = Math.max(0, sceneNodes.length - 8);

  // Generic property rows — strings, numbers, booleans, arrays we don't have
  // a dedicated panel for.
  const fieldRows = useMemo<Array<[string, unknown]>>(() => {
    return Object.entries(props).filter(([k]) => !isHiddenField(k));
  }, [props]);

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
          {kind && <KindChip kind={kind} />}
          {roleCode && <span className="chip hot">{ROLE_ZH[roleCode] || roleCode}</span>}
          {typeof age === "number" && age > 0 && <span className="chip">{age} 岁</span>}
          {typeof tension === "number" && (
            <span className="chip hot">张力 {tension}</span>
          )}
          {Array.isArray(statusTags) &&
            statusTags
              .filter((t): t is string => typeof t === "string" && t.length > 0)
              .map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
          {typeof isReal === "boolean" && (
            <span className="chip">{isReal ? "真身" : "马甲"}</span>
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
      <InspectorRow k="标签">{node.labels.join(" · ") || "—"}</InspectorRow>

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
            <button className="btn sm primary" onClick={rename} disabled={busy}>
              保存
            </button>
          </div>
        </div>
      )}

      {/* Type-specific extras: surface the highest-value field for the kind. */}
      {node.labels.includes("Misunderstanding") && typeof severity === "number" && (
        <InspectorRow k="严重程度">
          <Stars value={severity} max={5} />
        </InspectorRow>
      )}
      {node.labels.includes("Beat") && typeof tension === "number" && (
        <InspectorRow k="张力 (1–10)">
          <Bar value={tension} max={10} />
        </InspectorRow>
      )}

      {/* Character → Identity panel (surfaced before generic neighbors). */}
      {identityNeighbors.length > 0 && (
        <div>
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 6 }}>
            身份 ({identityNeighbors.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {identityNeighbors.map((n) => (
              <NeighborChip
                key={n.uuid}
                node={n}
                onSelect={onSelectNeighbor}
                trailing={
                  typeof n.properties.is_real === "boolean"
                    ? n.properties.is_real
                      ? "(真身)"
                      : "(马甲)"
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Basic attributes table (replaces the old <pre>JSON</pre>). */}
      {fieldRows.length > 0 && (
        <div>
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 4 }}>
            基础属性
          </div>
          <FieldsTable fields={fieldRows} />
        </div>
      )}

      {/* 1-hop neighbors (excluding Identity nodes already shown above). */}
      {genericNeighbors.length > 0 && (
        <div>
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 6 }}>
            1-hop 邻居 ({genericNeighbors.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {genericNeighbors.map((n) => (
              <NeighborChip key={n.uuid} node={n} onSelect={onSelectNeighbor} />
            ))}
          </div>
        </div>
      )}

      {/* Scene appearances — collapsible past 8. */}
      {sceneNodes.length > 0 && (
        <div>
          <div className="tiny muted" style={{ letterSpacing: 0, marginBottom: 6 }}>
            出现于 ({sceneNodes.length} 场)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {visibleScenes.map((s) => (
              <span
                key={s.uuid}
                className="chip"
                style={{ fontSize: 11, cursor: onSelectNeighbor ? "pointer" : "default" }}
                onClick={() => onSelectNeighbor?.(s.uuid)}
                title={s.name ?? s.uuid}
              >
                {sceneTag(s)}
              </span>
            ))}
          </div>
          {hiddenSceneCount > 0 && (
            <button
              className="btn sm ghost"
              style={{ marginTop: 6 }}
              onClick={() => setShowAllScenes((v) => !v)}
            >
              {showAllScenes ? "收起" : `展开剩余 ${hiddenSceneCount} 场`}
            </button>
          )}
        </div>
      )}

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

// Two-column key/value table. Hidden fields are filtered upstream so this
// is a pure view component.
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

// Kind chip carries the kind's color as a tinted background. We use the
// CSS var directly via color-mix so we don't have to define new classes.
function KindChip({ kind }: { kind: string }) {
  const varName = KIND_COLOR_VARS[kind];
  const style: React.CSSProperties = varName
    ? {
        background: `color-mix(in srgb, var(${varName}) 18%, transparent)`,
        borderColor: `color-mix(in srgb, var(${varName}) 50%, transparent)`,
        color: "var(--ink-800)",
      }
    : {};
  return (
    <span className="chip" style={style}>
      {KIND_ZH[kind] || kind}
    </span>
  );
}

// Neighbor chip — clickable when onSelect is provided. Background color is
// tinted from the neighbor's entity-kind CSS var.
function NeighborChip({
  node,
  onSelect,
  trailing,
}: {
  node: NodeDTO;
  onSelect?: (uuid: string) => void;
  trailing?: string;
}) {
  const varName = nodeColorVar(node);
  const style: React.CSSProperties = {
    background: `color-mix(in srgb, var(${varName}) 18%, transparent)`,
    borderColor: `color-mix(in srgb, var(${varName}) 50%, transparent)`,
    color: "var(--ink-800)",
    cursor: onSelect ? "pointer" : "default",
    fontSize: 12,
  };
  return (
    <span
      className="chip"
      style={style}
      onClick={() => onSelect?.(node.uuid)}
      title={node.labels.join(" · ")}
    >
      {node.name ?? node.uuid.slice(0, 8)}
      {trailing && <span className="tiny muted">{trailing}</span>}
    </span>
  );
}

// Filled-star rating, e.g. severity 1–5. Falsy / out-of-range values still
// render as zero filled stars so the row is consistent.
function Stars({ value, max }: { value: number; max: number }) {
  const filled = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <span style={{ letterSpacing: 2, color: "var(--warn, #d68900)" }} aria-label={`${filled} / ${max}`}>
      {"★".repeat(filled)}
      <span style={{ color: "var(--ink-300)" }}>{"☆".repeat(max - filled)}</span>
    </span>
  );
}

// Tiny inline progress bar for tension_level (Beat 1–10).
function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 6,
          background: "var(--ink-200)",
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--beat-500, #b34a3a)",
          }}
        />
      </div>
      <span className="mono tiny" style={{ color: "var(--ink-700)" }}>
        {value} / {max}
      </span>
    </div>
  );
}
