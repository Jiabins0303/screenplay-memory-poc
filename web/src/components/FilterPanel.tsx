import type { NodeDTO } from "../types";
import { KIND_ZH } from "../mockdata";
import { CATEGORY_COLOR, categoryFor } from "../lib/graphTheme";

interface Props {
  detailNodes: NodeDTO[];
  hlNodes: NodeDTO[];
  hidden: Set<string>;
  onToggle: (label: string) => void;
  onRefresh: () => void;
  showInfra: boolean;
  onToggleInfra: () => void;
}

export default function FilterRail({
  detailNodes,
  hlNodes,
  hidden,
  onToggle,
  onRefresh,
  showInfra,
  onToggleInfra,
}: Props) {
  // Count nodes per kind label, plus capture an exemplar node so we can
  // ask graphTheme.categoryFor() what color to dot. Keying on the label
  // alone wouldn't carry enough info for category resolution.
  const counts = new Map<string, { n: number; sample: NodeDTO }>();
  for (const n of [...detailNodes, ...hlNodes]) {
    for (const l of n.labels) {
      if (l === "Entity" || l === "Episodic") continue;
      const cur = counts.get(l);
      if (cur) cur.n += 1;
      else counts.set(l, { n: 1, sample: n });
    }
  }
  const rows = Array.from(counts.entries()).sort((a, b) => b[1].n - a[1].n);

  return (
    <aside
      style={{
        width: 208,
        padding: "20px 16px",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        color: "var(--text)",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: 1.2,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          筛选 · Filter
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map(([label, { n, sample }]) => {
            const dot = CATEGORY_COLOR[categoryFor(sample)];
            const on = !hidden.has(label);
            return (
              <button
                key={label}
                onClick={() => onToggle(label)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 10px",
                  borderRadius: 8,
                  background: on ? "rgba(255,255,255,0.06)" : "transparent",
                  border: "1px solid " + (on ? "var(--border)" : "transparent"),
                  opacity: on ? 1 : 0.4,
                  textAlign: "left",
                  color: "var(--text)",
                  cursor: "pointer",
                  transition: "background .12s, opacity .12s",
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: dot,
                    flexShrink: 0,
                    boxShadow: on ? `0 0 8px ${dot}66` : "none",
                  }}
                />
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                  {KIND_ZH[label] || label}
                </span>
                <div style={{ flex: 1 }} />
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {n}
                </span>
              </button>
            );
          })}
          {rows.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              尚无可过滤的类型
            </div>
          )}
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: 1.2,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 10,
            fontWeight: 600,
          }}
        >
          关系类型 · Edges
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Legend label="KNOWS · 认知边" />
          <Legend label="PRESENT_IN · 出场" />
          <Legend label="FOLLOWS · 时序" />
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 4px",
          fontSize: 12,
          color: "var(--text-dim)",
          cursor: "pointer",
          userSelect: "none",
        }}
        title="Graphiti 给每个节点都挂一个 Entity / Episodic 标签，没有领域子类型的节点是底层簿记。默认隐藏。"
      >
        <input
          type="checkbox"
          checked={showInfra}
          onChange={onToggleInfra}
          style={{
            width: 14,
            height: 14,
            accentColor: "#74b9ff",
            cursor: "pointer",
          }}
        />
        基础设施节点
      </label>

      <button
        onClick={onRefresh}
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "rgba(255,255,255,0.10)",
          color: "var(--text)",
          border: "1px solid var(--border-strong)",
          borderRadius: 8,
          fontSize: 12,
          cursor: "pointer",
          letterSpacing: 0.4,
          transition: "background .12s",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "rgba(255,255,255,0.18)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "rgba(255,255,255,0.10)")
        }
      >
        重新加载
      </button>
    </aside>
  );
}

function Legend({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
        fontSize: 12,
        color: "var(--text-muted)",
      }}
    >
      <svg width="18" height="6" style={{ flexShrink: 0 }}>
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke="rgba(180,200,255,0.55)"
          strokeWidth="1.4"
          strokeDasharray="2 2"
        />
      </svg>
      <span style={{ flexShrink: 0 }}>{label}</span>
    </div>
  );
}
