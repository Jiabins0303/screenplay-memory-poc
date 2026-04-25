export default function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 246 }}>
      <span className="seal">01</span>
      <div style={{ lineHeight: 1.2 }}>
        <div
          style={{ fontSize: 15, color: "var(--ink-900)", fontWeight: 700 }}
        >
          Screenplay Memory
        </div>
        <div className="tiny muted" style={{ marginTop: 2 }}>
          剧本知识管理
        </div>
      </div>
    </div>
  );
}
