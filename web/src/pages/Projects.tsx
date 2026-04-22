import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ProjectInfo } from "../types";
import { useUI } from "../store";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setProject = useUI((s) => s.setProject);
  const navigate = useNavigate();

  async function refresh() {
    try {
      const rows = await api.get<ProjectInfo[]>("/projects");
      setProjects(rows);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const body = newId.trim() ? { project_id: newId.trim() } : {};
      const p = await api.post<ProjectInfo>("/projects", body);
      setNewId("");
      await refresh();
      setProject(p.project_id);
      navigate("/ontology");
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function select(pid: string) {
    setProject(pid);
    navigate("/graph");
  }

  async function clearProject(pid: string) {
    if (!confirm(`确定清空项目 ${pid} 的全部图谱数据？`)) return;
    try {
      await api.del(`/projects/${pid}`);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">项目</h1>

      <div className="mb-6 flex gap-2">
        <input
          className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm"
          placeholder="项目 ID（留空则自动生成）"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
        />
        <button
          disabled={creating}
          onClick={create}
          className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-4 py-2 rounded text-sm"
        >
          新建项目
        </button>
      </div>

      {error && (
        <div className="text-red-400 text-xs mb-3 whitespace-pre-wrap">{error}</div>
      )}

      <div className="divide-y divide-slate-800 border border-slate-800 rounded">
        {projects.length === 0 && (
          <div className="p-4 text-slate-500 text-sm">还没有项目 —— 新建一个开始。</div>
        )}
        {projects.map((p) => (
          <div key={p.project_id} className="flex items-center gap-4 p-3 hover:bg-slate-900">
            <div className="font-mono text-slate-200">{p.project_id}</div>
            <div className="text-xs text-slate-500">{p.created_at || ""}</div>
            <div className="ml-auto flex gap-2">
              <button
                className="text-sky-400 hover:underline text-sm"
                onClick={() => select(p.project_id)}
              >
                打开
              </button>
              <button
                className="text-red-400 hover:underline text-sm"
                onClick={() => clearProject(p.project_id)}
              >
                清空
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
