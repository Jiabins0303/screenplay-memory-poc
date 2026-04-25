import { DEMO_ONLY } from "../env";
import { useUI, Route } from "../store";
import Brand from "./Brand";

interface Tab {
  id: Route;
  label: string;
  en: string;
  requiresProject?: boolean;
}

const TABS: Tab[] = [
  { id: "projects", label: "项目", en: "01" },
  { id: "ontology", label: "结构", en: "02", requiresProject: true },
  { id: "ingest", label: "导入", en: "03", requiresProject: true },
  { id: "graph", label: "图谱", en: "04", requiresProject: true },
  { id: "boundary", label: "知识边界", en: "05", requiresProject: true },
];

interface Props {
  onSettings: () => void;
}

export default function TopNav({ onSettings }: Props) {
  const route = useUI((s) => s.route);
  const setRoute = useUI((s) => s.setRoute);
  const project = useUI((s) => s.project);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "0 24px",
        borderBottom: "1px solid var(--divider)",
        background: "#fff",
        flexShrink: 0,
        minHeight: 64,
      }}
    >
      <Brand />
      <nav
        style={{
          display: "flex",
          alignItems: "stretch",
          alignSelf: "stretch",
          borderLeft: "1px solid var(--divider)",
        }}
      >
        {TABS.map((t) => (
          <NavTab
            key={t.id}
            tab={t}
            active={route === t.id}
            disabled={t.requiresProject && !project}
            onClick={() => setRoute(t.id)}
          />
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      {project ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          <span className="chip">当前项目</span>
          <span
            style={{ color: "var(--ink-900)", fontSize: 14, fontWeight: 600 }}
          >
            {project.title}
          </span>
          <span className="tiny muted mono">{project.id}</span>
          {(DEMO_ONLY || project.demo) && (
            <span className="chip hot">{DEMO_ONLY ? "静态演示" : "示例"}</span>
          )}
        </div>
      ) : (
        <span className="tiny muted" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          未选择项目
        </span>
      )}
      {!DEMO_ONLY && (
        <button className="btn sm ghost" onClick={onSettings} style={{ marginLeft: 12 }}>
          设置
        </button>
      )}
    </header>
  );
}

interface NavTabProps {
  tab: Tab;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function NavTab({ tab, active, disabled, onClick }: NavTabProps) {
  return (
    <button
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      aria-disabled={disabled}
      style={{
        position: "relative",
        padding: "0 16px",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        color: disabled ? "var(--ink-400)" : active ? "var(--ink-900)" : "var(--ink-600)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        borderRight: "1px solid var(--divider)",
        transition: "color .15s, background .15s, border-color .15s",
        background: active ? "var(--ink-050)" : "transparent",
        borderTop: active ? "3px solid #e4002b" : "3px solid transparent",
        borderRadius: 0,
      }}
    >
      <span className="mono tiny" style={{ color: active ? "#e4002b" : "var(--ink-400)" }}>
        {tab.en}
      </span>
      <span style={{ fontSize: 13, fontWeight: active ? 650 : 500 }}>
        {tab.label}
      </span>
    </button>
  );
}
