import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import ProjectsPage from "./pages/Projects";
import OntologyPage from "./pages/OntologyEditor";
import IngestPage from "./pages/Ingest";
import GraphPage from "./pages/Graph";
import Settings from "./components/Settings";
import { useUI } from "./store";

export default function App() {
  const pid = useUI((s) => s.projectId);

  return (
    <div className="flex flex-col h-full font-sans">
      <header className="flex items-center gap-6 px-5 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
        <div className="font-semibold tracking-tight text-slate-100">
          剧本记忆层 · 交互式
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Tab to="/projects">项目</Tab>
          <Tab to="/ontology" disabled={!pid}>本体</Tab>
          <Tab to="/ingest" disabled={!pid}>导入</Tab>
          <Tab to="/graph" disabled={!pid}>图谱</Tab>
        </nav>
        <div className="ml-auto text-xs text-slate-400">
          {pid ? `当前项目：${pid}` : "未选择项目"}
        </div>
        <Settings />
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/ontology" element={<OntologyPage />} />
          <Route path="/ingest" element={<IngestPage />} />
          <Route path="/graph" element={<GraphPage />} />
        </Routes>
      </main>
    </div>
  );
}

function Tab({
  to,
  children,
  disabled = false,
}: {
  to: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  if (disabled) {
    return <span className="text-slate-600 cursor-not-allowed">{children}</span>;
  }
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        isActive
          ? "text-sky-400 border-b-2 border-sky-400 pb-1"
          : "text-slate-300 hover:text-slate-100"
      }
    >
      {children}
    </NavLink>
  );
}
