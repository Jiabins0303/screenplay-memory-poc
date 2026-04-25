import type { NodeDTO } from "../types";
import { KIND_COLOR, KIND_ZH } from "../mockdata";

interface Props {
  detailNodes: NodeDTO[];
  hlNodes: NodeDTO[];
  hidden: Set<string>;
  onToggle: (label: string) => void;
  onRefresh: () => void;
}

export default function FilterRail({
  detailNodes,
  hlNodes,
  hidden,
  onToggle,
  onRefresh,
}: Props) {
  const counts = new Map<string, number>();
  for (const n of [...detailNodes, ...hlNodes]) {
    for (const l of n.labels) {
      if (l === "Entity" || l === "Episodic") continue;
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }
  const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <aside
      style={{
        width: 188,
        padding: "18px 16px",
        background: "#fff",
        borderRight: "1px solid var(--divider)",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <div className="kicker" style={{ marginBottom: 10 }}>
          筛选
        </div>
        <div className="col" style={{ gap: 6 }}>
          {rows.map(([label, n]) => {
            const c = KIND_COLOR[label] || "--ink-500";
            const on = !hidden.has(label);
            return (
              <button
                key={label}
                onClick={() => onToggle(label)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: 0,
                  background: on ? "var(--ink-200)" : "transparent",
                  border: "1px solid " + (on ? "var(--divider)" : "transparent"),
                  opacity: on ? 1 : 0.45,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 0,
                    background: `var(${c})`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, color: "var(--ink-700)" }}>
                  {KIND_ZH[label] || label}
                </span>
                <div style={{ flex: 1 }} />
                <span className="tiny mono muted">{n}</span>
              </button>
            );
          })}
          {rows.length === 0 && (
            <div className="tiny dim">尚无可过滤的类型</div>
          )}
        </div>
      </div>

      <div>
        <div className="kicker" style={{ marginBottom: 10 }}>
          关系类型
        </div>
        <div className="col" style={{ gap: 4 }}>
          <Legend label="KNOWS · 认知边" />
          <Legend label="PRESENT_IN · 出场" />
          <Legend label="FOLLOWS · 时序" />
        </div>
      </div>

      <div style={{ flex: 1 }} />
      <button className="btn sm block" onClick={onRefresh}>
        重新加载
      </button>
    </aside>
  );
}

function Legend({ label }: { label: string }) {
  return (
    <div
      className="tiny muted"
      style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
    >
      <svg width="18" height="6" style={{ flexShrink: 0 }}>
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke="var(--seal-500)"
          strokeWidth="1.4"
          strokeDasharray="2 2"
        />
      </svg>
      <span style={{ flexShrink: 0 }}>{label}</span>
    </div>
  );
}
