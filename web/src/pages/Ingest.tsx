import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { streamIngest } from "../api";
import { useUI } from "../store";

interface SceneRow {
  episode: number;
  scene: number;
  body: string;
}

const DEFAULT_TEMPLATE = `# 第1集第1场
李静走进咖啡馆，看到张伟已经在角落的位置坐着……

# 第1集第2场
张伟独自坐在咖啡馆，回想着李静告诉他的事……

# 第1集第3场
周雅静站在窗前，望着外面的街景……`;

function segment(raw: string): SceneRow[] {
  // Split by "# 第X集第Y场" or "# 第Y场" headers. The header line itself
  // is NOT included in body — it only supplies (episode, scene) numbers.
  const headerRe = /^#\s*第(\d+)集第(\d+)场/gm;
  const matches = Array.from(raw.matchAll(headerRe));
  const rows: SceneRow[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const ep = parseInt(m[1], 10);
    const sc = parseInt(m[2], 10);
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? raw.length : raw.length;
    const body = raw.slice(start, end).trim();
    if (body) rows.push({ episode: ep, scene: sc, body });
  }
  return rows;
}

export default function IngestPage() {
  const pid = useUI((s) => s.projectId);
  const navigate = useNavigate();
  const [raw, setRaw] = useState(DEFAULT_TEMPLATE);
  const [runHl, setRunHl] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const segmented = useMemo(() => segment(raw), [raw]);

  if (!pid) {
    return <div className="p-8">先在「项目」页选一个项目。</div>;
  }

  async function run() {
    if (segmented.length === 0) {
      alert("没有检测到任何场次 —— 用 '# 第X集第Y场' 分隔");
      return;
    }
    setEvents([]);
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      await streamIngest(
        pid!,
        { segmentation: segmented, run_hl: runHl },
        (ev) => {
          setEvents((prev) => [
            ...prev,
            `[${ev.event}] ${JSON.stringify(ev.data, null, 0)}`,
          ]);
        },
        abortRef.current.signal,
      );
    } catch (e) {
      setEvents((prev) => [...prev, `ERROR: ${String(e)}`]);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setBusy(false);
  }

  return (
    <div className="flex h-full">
      <section className="flex-1 flex flex-col p-5 border-r border-slate-800">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-semibold">剧本输入</h2>
          <div className="text-xs text-slate-500">
            用 <code className="bg-slate-900 px-1 rounded">"# 第X集第Y场"</code>{" "}
            分隔场次
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={runHl}
              onChange={(e) => setRunHl(e.target.checked)}
            />
            同时跑高层节拍层
          </label>
        </div>
        <textarea
          className="flex-1 bg-slate-950 border border-slate-700 rounded p-3 font-mono text-sm resize-none"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div className="flex items-center gap-3 mt-3">
          <div className="text-xs text-slate-400">
            解析到 {segmented.length} 场
          </div>
          {busy ? (
            <button
              className="ml-auto bg-red-600 hover:bg-red-500 px-4 py-2 rounded text-sm"
              onClick={cancel}
            >
              中止
            </button>
          ) : (
            <button
              className="ml-auto bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded text-sm"
              onClick={run}
              disabled={segmented.length === 0}
            >
              开始导入
            </button>
          )}
        </div>
      </section>

      <aside className="w-[36%] min-w-[320px] flex flex-col p-5">
        <div className="flex items-center mb-3">
          <h2 className="font-semibold">导入进度</h2>
          {!busy && events.some((e) => e.startsWith("[done]")) && (
            <button
              className="ml-auto text-sky-400 text-sm"
              onClick={() => navigate("/graph")}
            >
              查看图谱 →
            </button>
          )}
        </div>
        <div className="flex-1 bg-slate-950 border border-slate-800 rounded p-3 overflow-auto font-mono text-xs">
          {events.length === 0 && (
            <div className="text-slate-600">尚未开始</div>
          )}
          {events.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {line}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
