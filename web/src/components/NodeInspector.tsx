import { useMemo, useState } from "react";
import { api } from "../api";
import type { GraphDTO, NodeDTO } from "../types";
import { KIND_ZH, ROLE_ZH } from "../mockdata";
import { CATEGORY_COLOR, categoryFor, nodeLayerKind } from "../lib/graphTheme";

interface Props {
  projectId: string;
  demo: boolean;
  node: NodeDTO;
  graph: GraphDTO;
  // Optional cross-layer bridge graph. When the selected node is HL,
  // the inspector resolves "覆盖场景" via Beat→Scene COVERS edges from
  // this graph instead of the active-layer `graph`.
  bridgeGraph?: GraphDTO;
  onRefresh: () => void;
  onClose: () => void;
  onSelectNeighbor?: (uuid: string) => void;
}

// Fields hidden from the generic FieldsTable. Embeddings are noisy, and
// scene_appearances / quotes get their own dedicated sections.
const HIDDEN_FIELD_PREFIXES = ["_"];
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
  bridgeGraph,
  onRefresh,
  onClose,
  onSelectNeighbor,
}: Props) {
  const layerKind = nodeLayerKind(node);
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
  const isReal = props.is_real as boolean | undefined;

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

  // 1-hop neighbors (deduped). Edge direction doesn't matter — the
  // inspector just wants "who is connected to me".
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

  const identityNeighbors = useMemo(() => {
    if (!node.labels.includes("Character")) return [];
    return neighbors.filter((n) => n.labels.includes("Identity"));
  }, [neighbors, node.labels]);

  const genericNeighbors = useMemo(() => {
    if (identityNeighbors.length === 0) return neighbors;
    const idSet = new Set(identityNeighbors.map((n) => n.uuid));
    return neighbors.filter((n) => !idSet.has(n.uuid));
  }, [neighbors, identityNeighbors]);

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

  const fieldRows = useMemo<Array<[string, unknown]>>(() => {
    return Object.entries(props).filter(([k]) => !isHiddenField(k));
  }, [props]);

  // For HL nodes, resolve covered scenes via Beat→Scene COVERS edges in
  // the bridge graph. The bridge graph is a separate layer fetch that
  // Graph.tsx threads in; we tolerate it being missing or empty.
  const coveredScenes = useMemo<NodeDTO[]>(() => {
    if (layerKind !== "hl" || !bridgeGraph) return [];
    if (!node.labels.includes("Beat")) return []; // Theme/Arc/Trope don't COVER scenes
    const sceneIds = new Set<string>();
    for (const e of bridgeGraph.edges) {
      if (e.type !== "COVERS") continue;
      if (e.source === node.uuid) sceneIds.add(e.target);
      else if (e.target === node.uuid) sceneIds.add(e.source);
    }
    const out: NodeDTO[] = [];
    for (const id of sceneIds) {
      const s = bridgeGraph.nodes.find((n) => n.uuid === id);
      if (s) out.push(s);
    }
    return out;
  }, [layerKind, bridgeGraph, node.uuid, node.labels]);

  // HL-specific surface fields. Empty when not HL.
  const beatType = layerKind === "hl" ? (props.beat_type as string | undefined) : undefined;
  const themeName = layerKind === "hl" ? (props.theme_name as string | undefined) : undefined;
  const arcName = layerKind === "hl" ? (props.arc_name as string | undefined) : undefined;
  const tropeName = layerKind === "hl" ? (props.trope_name as string | undefined) : undefined;

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
            color: "var(--text)",
            fontWeight: 700,
            wordBreak: "break-all",
          }}
        >
          {name || node.uuid}
        </div>
        <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
          {kind && <KindChip node={node} kind={kind} />}
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
          style={{
            padding: "8px 10px",
            background: "rgba(253, 203, 110, 0.10)",
            borderLeft: "2px solid #fdcb6e",
            borderRadius: 4,
            fontSize: 12,
            color: "var(--text-dim)",
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
          <div className="tiny muted" style={{ marginBottom: 6 }}>
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

      {layerKind === "generic" && (
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(255,255,255,0.04)",
            borderLeft: "2px solid var(--border-strong)",
            borderRadius: 4,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          Graphiti 内部节点 · 不应在故事图谱中出现。
        </div>
      )}

      {/* Detail-layer-only display sections. HL nodes (Beat/Arc/Theme/Trope)
          don't carry severity / Identity neighbors / scene_appearances, so
          gating these prevents the empty-section noise the user reported. */}
      {layerKind === "detail" &&
        node.labels.includes("Misunderstanding") &&
        typeof severity === "number" && (
          <InspectorRow k="严重程度">
            <Stars value={severity} max={5} />
          </InspectorRow>
        )}

      {/* HL-specific surface: type chip + tension bar + covered scenes. */}
      {layerKind === "hl" && (
        <>
          {(beatType || themeName || arcName || tropeName) && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {beatType && (
                <span className="chip" style={{ borderColor: "rgba(253,203,110,0.55)", color: "#fde7a7" }}>
                  {beatType}
                </span>
              )}
              {themeName && (
                <span className="chip" style={{ borderColor: "rgba(162,155,254,0.55)", color: "#dcd8ff" }}>
                  主题 · {themeName}
                </span>
              )}
              {arcName && (
                <span className="chip" style={{ borderColor: "rgba(116,185,255,0.55)", color: "#cfe7ff" }}>
                  弧光 · {arcName}
                </span>
              )}
              {tropeName && (
                <span className="chip" style={{ borderColor: "rgba(253,203,110,0.55)", color: "#fde7a7" }}>
                  套路 · {tropeName}
                </span>
              )}
            </div>
          )}
          {node.labels.includes("Beat") && typeof tension === "number" && (
            <InspectorRow k="张力 (1–10)">
              <Bar value={tension} max={10} />
            </InspectorRow>
          )}
          {coveredScenes.length > 0 && (
            <div>
              <div className="tiny muted" style={{ marginBottom: 8 }}>
                覆盖场景 ({coveredScenes.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {coveredScenes.map((s) => (
                  <span
                    key={s.uuid}
                    className="chip"
                    style={{ cursor: onSelectNeighbor ? "pointer" : "default" }}
                    onClick={() => onSelectNeighbor?.(s.uuid)}
                    title={s.name ?? s.uuid}
                  >
                    {sceneTag(s)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {layerKind === "detail" && identityNeighbors.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
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

      {fieldRows.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            基础属性
          </div>
          <FieldsTable fields={fieldRows} />
        </div>
      )}

      {genericNeighbors.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
            1-hop 邻居 ({genericNeighbors.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {genericNeighbors.map((n) => (
              <NeighborChip key={n.uuid} node={n} onSelect={onSelectNeighbor} />
            ))}
          </div>
        </div>
      )}

      {layerKind === "detail" && sceneNodes.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
            出现于 ({sceneNodes.length} 场)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {visibleScenes.map((s) => (
              <span
                key={s.uuid}
                className="chip"
                style={{ cursor: onSelectNeighbor ? "pointer" : "default" }}
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
        <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
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
        <div style={{ fontSize: 12, color: "#fca5a5", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}
    </aside>
  );
}

function InspectorRow({ k, children }: { k: string; children: React.ReactNode }) {
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

function KindChip({ node, kind }: { node: NodeDTO; kind: string }) {
  const color = CATEGORY_COLOR[categoryFor(node)];
  const style: React.CSSProperties = {
    background: `color-mix(in srgb, ${color} 18%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 50%, transparent)`,
    color: "#ffffff",
  };
  return (
    <span className="chip" style={style}>
      {KIND_ZH[kind] || kind}
    </span>
  );
}

function NeighborChip({
  node,
  onSelect,
  trailing,
}: {
  node: NodeDTO;
  onSelect?: (uuid: string) => void;
  trailing?: string;
}) {
  const color = CATEGORY_COLOR[categoryFor(node)];
  const style: React.CSSProperties = {
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
    color: "var(--text)",
    cursor: onSelect ? "pointer" : "default",
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

function Stars({ value, max }: { value: number; max: number }) {
  const filled = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <span style={{ letterSpacing: 2, color: "#fdcb6e" }} aria-label={`${filled} / ${max}`}>
      {"★".repeat(filled)}
      <span style={{ color: "rgba(255,255,255,0.20)" }}>{"☆".repeat(max - filled)}</span>
    </span>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "rgba(255,255,255,0.10)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "linear-gradient(90deg, #74b9ff, #a29bfe)",
          }}
        />
      </div>
      <span className="mono tiny" style={{ color: "var(--text-dim)" }}>
        {value} / {max}
      </span>
    </div>
  );
}
