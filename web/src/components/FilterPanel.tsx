import type { NodeDTO } from "../types";

interface Props {
  nodes: NodeDTO[];
  active: Set<string>;
  onToggle: (label: string) => void;
}

export default function FilterPanel({ nodes, active, onToggle }: Props) {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    for (const l of n.labels) {
      if (l === "Entity" || l === "Episodic") continue;
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }

  const labels = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (labels.length === 0) {
    return <div className="text-xs text-slate-500">暂无可过滤的类型</div>;
  }

  return (
    <div className="space-y-1">
      {labels.map(([label, count]) => (
        <label
          key={label}
          className="flex items-center gap-2 text-xs cursor-pointer hover:text-slate-100"
        >
          <input
            type="checkbox"
            checked={active.has(label)}
            onChange={() => onToggle(label)}
          />
          <span className="flex-1">{label}</span>
          <span className="text-slate-500">{count}</span>
        </label>
      ))}
    </div>
  );
}
