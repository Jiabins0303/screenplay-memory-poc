// Projects page — screenplay case-files with ordinal seal, genre, status,
// three-stat row. When the backend returns no projects, we transparently
// seed with MOCK_PROJECTS so the design's hero shot isn't ruined by an
// empty state on first run. Opening a demo project puts the UI in "demo
// mode" (project.demo === true), which the other pages check so they can
// fall back to MOCK content without a real backend round-trip.

import { useEffect, useState } from "react";
import { api } from "../api";
import { DEMO_ONLY } from "../env";
import type { ProjectInfo } from "../types";
import { MOCK_PROJECTS, MockProject } from "../mockdata";
import { useUI } from "../store";
import Modal from "../components/Modal";

type DisplayProject = MockProject;

function backendToDisplay(p: ProjectInfo): DisplayProject {
  return {
    id: p.project_id,
    title: p.project_id,
    ep: 0,
    scenes: 0,
    updated: (p.created_at || "").slice(0, 10),
    status: "草稿",
    genre: "未定",
    lead: "项目负责人",
  };
}

export default function ProjectsPage() {
  const [backendProjects, setBackendProjects] = useState<ProjectInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const setProject = useUI((s) => s.setProject);
  const setRoute = useUI((s) => s.setRoute);

  const refresh = async () => {
    if (DEMO_ONLY) {
      setBackendProjects([]);
      setError(null);
      return;
    }
    try {
      const rows = await api.get<ProjectInfo[]>("/projects");
      setBackendProjects(rows);
      setError(null);
    } catch (e) {
      setBackendProjects([]);
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const useMock = DEMO_ONLY || (backendProjects && backendProjects.length === 0);
  const list: DisplayProject[] = useMock
    ? MOCK_PROJECTS
    : (backendProjects ?? []).map(backendToDisplay);

  async function create() {
    const title = newTitle.trim();
    if (!title || DEMO_ONLY) return;
    try {
      const res = await api.post<ProjectInfo>("/projects", { project_id: title });
      setCreating(false);
      setNewTitle("");
      await refresh();
      setProject({ id: res.project_id, title: res.project_id, demo: false });
      setRoute("ontology");
    } catch (e) {
      setError(String(e));
    }
  }

  async function openProject(p: DisplayProject) {
    setProject({ id: p.id, title: p.title, demo: DEMO_ONLY || !!p.demo });
    setRoute("graph");
  }

  async function clearProject(p: DisplayProject, e: React.MouseEvent) {
    e.stopPropagation();
    if (p.demo) {
      alert("示例项目无法清空。");
      return;
    }
    if (!confirm(`清空项目 "${p.id}"？该操作不可逆。`)) return;
    try {
      await api.del(`/projects/${p.id}`);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="swiss-page">
      <div className="swiss-shell">
        <div className="swiss-heading">
          <div className="swiss-number">01</div>
          <div>
            <h1 className="swiss-title">项目</h1>
            <div className="swiss-copy">
              管理剧本项目、导入内容并查看知识图谱。
              {DEMO_ONLY
                ? " 当前为静态演示版，无需后端即可浏览核心功能。"
                : useMock && " 当前显示示例数据，创建项目后将切换到真实工作区。"}
            </div>
          </div>
          {!DEMO_ONLY && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              新建项目
            </button>
          )}
        </div>

        {DEMO_ONLY && (
          <div
            className="panel"
            style={{
              padding: 12,
              marginBottom: 20,
              borderLeft: "3px solid var(--ink-900)",
              color: "var(--ink-700)",
              fontSize: 13,
            }}
          >
            静态演示版只展示示例数据。真实导入、查询和编辑请使用 Docker 后端版本。
          </div>
        )}

        {!DEMO_ONLY && error && (
          <div
            className="panel"
            style={{
              padding: 12,
              marginBottom: 20,
              borderLeft: "3px solid var(--err)",
              color: "var(--cinnabar-400)",
              fontSize: 12.5,
            }}
          >
            后端连接失败：{error}。已切换到离线示例。
          </div>
        )}

        <div className="stagger-in swiss-card-grid">
          {list.map((p, i) => (
            <div
              key={p.id}
              style={{ "--i": i } as React.CSSProperties}
            >
              <ProjectCard
                project={p}
                index={i}
                onOpen={() => openProject(p)}
                onClear={(e) => clearProject(p, e)}
              />
            </div>
          ))}
          {!DEMO_ONLY && (
            <div style={{ "--i": list.length } as React.CSSProperties}>
              <NewCard onClick={() => setCreating(true)} />
            </div>
          )}
        </div>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="新建项目">
        <div className="col" style={{ gap: 10 }}>
          <div className="tiny muted">项目名称</div>
          <input
            className="input song"
            style={{ fontSize: 18, padding: "10px 12px" }}
            placeholder="例如：项目 A"
            value={newTitle}
            autoFocus
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              // Skip IME composition (Chinese pinyin selection commits via Enter).
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") create();
            }}
          />
          <div
            className="row"
            style={{ marginTop: 14, justifyContent: "flex-end", gap: 8 }}
          >
            <button className="btn ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button
              className="btn primary"
              onClick={create}
              disabled={!newTitle.trim()}
            >
              创建
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface CardProps {
  project: DisplayProject;
  index: number;
  onOpen: () => void;
  onClear: (e: React.MouseEvent) => void;
}

function ProjectCard({ project, onOpen, onClear }: CardProps) {
  const statusColor =
    project.status === "完稿"
      ? "var(--ok)"
      : project.status === "修订"
      ? "var(--warn)"
      : "var(--ink-600)";
  return (
    <div
      onClick={onOpen}
      style={{
        padding: 20,
        cursor: "pointer",
        position: "relative",
        minHeight: 190,
        background: "#fff",
        transition: "background .15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--ink-050)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fff";
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="chip">{project.status}</span>
        {project.demo && <span className="chip hot">示例</span>}
      </div>
      <div
        style={{
          fontSize: 20,
          color: "var(--ink-900)",
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        {project.title}
      </div>
      <div className="tiny muted mono" style={{ marginBottom: 18 }}>
        {project.id}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 4,
          marginBottom: 16,
        }}
      >
        <Stat n={project.ep} label="集" />
        <Stat n={project.scenes} label="场" />
        <Stat n={<StatusBar color={statusColor} />} label={project.status} />
      </div>
      <div className="row" style={{ borderTop: "1px solid var(--divider)", paddingTop: 12 }}>
        <span className="tiny muted">{project.lead}</span>
        <div style={{ flex: 1 }} />
        <span className="tiny muted mono">{project.updated}</span>
      </div>
      {!project.demo && (
        <button
          className="tiny"
          onClick={onClear}
          style={{
            position: "absolute",
            bottom: 14,
            right: 14,
            color: "var(--ink-500)",
            padding: "2px 6px",
            borderRadius: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--err)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-500)")}
        >
          清空
        </button>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: React.ReactNode; label: string }) {
  return (
    <div>
      <div style={{ fontSize: 20, color: "var(--ink-900)", lineHeight: 1, fontWeight: 650 }}>
        {n}
      </div>
      <div className="tiny muted" style={{ marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

function NewCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        minHeight: 176,
        border: "1px dashed var(--divider-strong)",
        borderRadius: 0,
        background: "#fff",
        color: "var(--ink-500)",
        cursor: "pointer",
        transition: "color .15s, border-color .15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--seal-500)";
        e.currentTarget.style.borderColor = "var(--seal-500)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "";
        e.currentTarget.style.borderColor = "";
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div className="mono" style={{ fontSize: 18, lineHeight: 1, marginBottom: 8, color: "#e4002b" }}>
          NEW
        </div>
        <div>新建项目</div>
      </div>
    </div>
  );
}

function StatusBar({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "block",
        width: 34,
        height: 4,
        background: color,
        marginTop: 8,
      }}
    />
  );
}
