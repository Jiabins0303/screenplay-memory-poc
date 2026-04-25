// Ingest page — manuscript editor on the left, live scene-by-scene timeline
// on the right. Replaces the prior log panel with per-scene dots that
// transition pending → ingesting → done as SSE events arrive.
//
// Segmentation falls through five patterns so a random Chinese script
// uploaded as-is still breaks cleanly into scenes; see `segment` below.

import { useMemo, useRef, useState } from "react";
import { streamIngest } from "../api";
import { DEMO_ONLY } from "../env";
import { useUI } from "../store";

interface SceneRow {
  ep: number;
  sc: number;
  body: string;
  key: string;
}

type RowState = "pending" | "ingesting" | "done" | "error";

interface ProgressRow extends SceneRow {
  state: RowState;
  entities: { kind: string; name: string }[];
  edges: number;
  tokens: number;
}

const DEFAULT_MANUSCRIPT = `# 第1集第1场
李静走进咖啡馆，看到张伟已经在角落的位置坐着，桌上摊着一封没有署名的信。
她把包放下，指尖触碰信纸时有一丝迟疑。
"这是寄给你的，"张伟把信推过去，"门卫今早收到的。"

# 第1集第2场
张伟独自坐在咖啡馆，反复翻阅着李静刚才交给他的那封信。
窗外夜色深沉。他看了看手机，删去了一条还没发出去的短信。

# 第1集第3场
周雅静站在窗前，望着外面的街景。
桌上摊着一本旧相册。她合上它，放回抽屉最深处，像是锁住了一段岁月。

# 第2集第4场
张伟瞒着李静去仁济医院的档案室。
在走廊转角，他遇到了二十年前接生李静的杨姝医生。

# 第2集第5场
张伟回家，李静正在做晚饭。
"今天去图书馆借了本新书，"他说，"明清家族史的。"李静没接话。

# 第4集第7场
李静翻出母亲藏起的旧相册。
相册最后一页，有一张她从未见过的年轻女子的照片。背面写着两个字：白芷。

# 第4集第8场
李静把照片放在茶几上。周雅静的手微微发抖。
沉默了很久，周雅静终于开口："你生母的名字，就是她。"`;

function segment(raw: string): SceneRow[] {
  const text = raw.trim();
  if (!text) return [];

  // Try "# 第X集第Y场" then "第X集第Y场" then "第N场". Fall back to blank-line chunks.
  const tryRegex = (re: RegExp, captureEp: boolean) => {
    const matches = Array.from(text.matchAll(re));
    if (matches.length === 0) return null;
    const rows: SceneRow[] = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const ep = captureEp ? parseInt(m[1], 10) : 1;
      const sc = captureEp ? parseInt(m[2], 10) : parseInt(m[1], 10);
      const start = (m.index ?? 0) + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
      const body = text.slice(start, end).trim();
      if (body) rows.push({ ep, sc, body, key: `${ep}-${sc}` });
    }
    return rows.length ? rows : null;
  };

  const r1 = tryRegex(/^#\s*第(\d+)集第(\d+)场[^\n]*/gm, true);
  if (r1) return r1;
  const r2 = tryRegex(/^\s*第(\d+)集第(\d+)场[^\n]*/gm, true);
  if (r2) return r2;
  const r3 = tryRegex(/^\s*第(\d+)场[^\n]*/gm, false);
  if (r3) return r3;

  const chunks = text.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  if (chunks.length > 1) {
    return chunks.map((body, i) => ({ ep: 1, sc: i + 1, body, key: `1-${i + 1}` }));
  }
  return [{ ep: 1, sc: 1, body: text, key: "1-1" }];
}

export default function IngestPage() {
  const project = useUI((s) => s.project);
  const [raw, setRaw] = useState(DEFAULT_MANUSCRIPT);
  const [runHl, setRunHl] = useState(true);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [overall, setOverall] = useState<"idle" | "running" | "done">("idle");
  const abortRef = useRef<AbortController | null>(null);

  const scenes = useMemo(() => segment(raw), [raw]);

  if (!project) {
    return <div style={{ padding: 40, color: "var(--ink-500)" }}>先选择或新建项目。</div>;
  }
  const isDemo = DEMO_ONLY || !!project.demo;
  const projectId = project.id;

  function markScene(key: string, patch: Partial<ProgressRow>) {
    setProgress((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function run(force = false) {
    if (!scenes.length) return;
    setOverall("running");
    setProgress(
      scenes.map((s) => ({ ...s, state: "pending", entities: [], edges: 0, tokens: 0 }))
    );

    if (isDemo) {
      await simulate(scenes);
      setOverall("done");
      return;
    }

    abortRef.current = new AbortController();
    try {
      await streamIngest(
        projectId,
        {
          segmentation: scenes.map((s) => ({ episode: s.ep, scene: s.sc, body: s.body })),
          run_hl: runHl,
          force,
        },
        (ev) => {
          if (ev.event === "scene_ingested") {
            const ep = ev.data.episode as number;
            const sc = ev.data.scene as number;
            const ec = (ev.data.entities_created as number) ?? 0;
            const fc = (ev.data.facts_created as number) ?? 0;
            markScene(`${ep}-${sc}`, {
              state: "done",
              entities: [{ kind: "角色", name: `+${ec} 节点` }],
              edges: fc,
              tokens: 0,
            });
            setProgress((rows) => {
              const nextIdx = rows.findIndex((r) => r.state === "pending");
              if (nextIdx >= 0) {
                const copy = rows.slice();
                copy[nextIdx] = { ...copy[nextIdx], state: "ingesting" };
                return copy;
              }
              return rows;
            });
          } else if (ev.event === "scene_skipped") {
            const ep = ev.data.episode as number;
            const sc = ev.data.scene as number;
            markScene(`${ep}-${sc}`, {
              state: "done",
              entities: [{ kind: "场景", name: "已缓存" }],
              edges: 0,
              tokens: 0,
            });
          } else if (ev.event === "segment") {
            setProgress((rows) => {
              if (!rows.length) return rows;
              return rows.map((r, i) => (i === 0 ? { ...r, state: "ingesting" } : r));
            });
          } else if (ev.event === "error") {
            const msg = (ev.data.message as string) || "未知错误";
            setProgress((rows) =>
              rows.map((r) => (r.state === "ingesting" ? { ...r, state: "error", entities: [{ kind: "事件", name: msg.slice(0, 16) }] } : r))
            );
            setOverall("idle");
          } else if (ev.event === "done") {
            setOverall("done");
          }
        },
        abortRef.current.signal,
      );
    } catch (e) {
      setProgress((rows) =>
        rows.map((r) => (r.state !== "done" ? { ...r, state: "error", entities: [{ kind: "事件", name: String(e).slice(0, 20) }] } : r))
      );
      setOverall("idle");
    }
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setOverall("idle");
    setProgress((rows) => rows.map((r) => (r.state === "ingesting" ? { ...r, state: "pending" } : r)));
  }

  async function simulate(rows: SceneRow[]) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      markScene(r.key, { state: "ingesting" });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, 700 + Math.random() * 900));
      const entities = pickEntities(r);
      markScene(r.key, {
        state: "done",
        entities,
        edges: Math.max(0, entities.length - 1),
        tokens: Math.round(r.body.length * 1.4),
      });
    }
  }

  const doneCount = progress.filter((p) => p.state === "done").length;
  const pct = scenes.length ? (doneCount / scenes.length) * 100 : 0;
  const running = overall === "running";

  return (
    <div
      className="stagger-in"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 424px",
        height: "100%",
        minHeight: 0,
        background:
          "linear-gradient(90deg, var(--hairline) 1px, transparent 1px), linear-gradient(180deg, var(--hairline) 1px, transparent 1px), var(--ink-050)",
        backgroundSize: "calc(100% / 12) 100%, 64px 64px, auto",
      }}
    >
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "28px 32px",
          minHeight: 0,
          borderRight: "1px solid var(--divider)",
          "--i": 0,
        } as React.CSSProperties}
      >
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="swiss-number" style={{ fontSize: 42 }}>
            03
          </div>
          <div>
            <div style={{ fontSize: 24, color: "var(--ink-900)", fontWeight: 700 }}>
              内容导入
            </div>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
              粘贴或上传剧本内容，系统将按场次切分并生成图谱。
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <label
            className="row"
            style={{ gap: 8, fontSize: 13, cursor: "pointer", marginRight: 12 }}
          >
            <input
              type="file"
              accept=".txt,.md,.fountain,text/*"
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setRaw(await f.text());
              }}
            />
            <span style={{ color: "var(--ink-700)" }}>上传文件</span>
          </label>
          <label className="row" style={{ gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={runHl}
              onChange={(e) => setRunHl(e.target.checked)}
            />
            同步生成节拍层
          </label>
        </div>

        <div
          className="panel"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            background: "#fff",
            border: "1px solid var(--divider)",
            borderRadius: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 16px",
              borderBottom: "1px solid var(--divider)",
              background: "var(--ink-050)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            <span className="mono">格式</span>
            <span>
              用{" "}
              <code style={{ color: "var(--ink-900)", fontFamily: "var(--font-mono)" }}>
                「# 第X集第Y场」
              </code>{" "}
              切分场次，若无标记按空行自动分段
            </span>
            <div style={{ flex: 1 }} />
            <span className="mono">{raw.length} 字</span>
          </div>
          <textarea
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              padding: "24px 32px",
              color: "var(--ink-800)",
              fontSize: 14,
              lineHeight: 1.75,
              outline: "none",
              resize: "none",
              fontFamily: "var(--font-sans)",
            }}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>

        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <span className="chip">
            已解析 {scenes.length} 场
          </span>
          {overall === "running" && (
            <span className="chip hot">导入中 · {doneCount} / {scenes.length}</span>
          )}
          {overall === "done" && (
            <span
              className="chip"
              style={{ color: "var(--ok)", borderColor: "var(--divider-strong)" }}
            >
              完成
            </span>
          )}
          <span className="tiny" style={{ color: "var(--warn)", marginLeft: 4 }}>
            每场约 30-60 秒，两场并行处理
          </span>
          <div style={{ flex: 1 }} />
          {running ? (
            <button className="btn danger" onClick={cancel}>
              中止导入
            </button>
          ) : overall === "done" ? (
            <>
              <button
                className="btn"
                onClick={() => run(false)}
                disabled={!scenes.length}
                style={{ marginRight: 6 }}
              >
                开始导入
              </button>
              <button
                className="btn primary"
                onClick={() => run(true)}
                disabled={!scenes.length}
              >
                强制重新导入
              </button>
            </>
          ) : (
            <button
              className="btn primary"
              onClick={() => run(false)}
              disabled={!scenes.length}
            >
              开始导入
            </button>
          )}
        </div>
      </section>

      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "28px 24px",
          minHeight: 0,
          background: "#fff",
          "--i": 1,
        } as React.CSSProperties}
      >
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="mono" style={{ color: "#e4002b", fontWeight: 700 }}>
            03B
          </div>
          <div>
            <div style={{ fontSize: 18, color: "var(--ink-900)", fontWeight: 700 }}>
              处理进度
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              height: 4,
              background: "var(--ink-150)",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "var(--ink-900)",
                transition: "width .4s ease",
              }}
            />
          </div>
          <div className="row tiny muted" style={{ marginTop: 6 }}>
            <span>
              {doneCount} / {scenes.length || "—"}
            </span>
            <div style={{ flex: 1 }} />
            <span>{Math.round(pct)}%</span>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            paddingRight: 6,
          }}
        >
          {(progress.length ? progress : (scenes as ProgressRow[])).map((s, i) => (
            <TimelineRow
              key={s.key}
              row={s}
              last={i === (progress.length || scenes.length) - 1}
            />
          ))}
          {!scenes.length && (
            <div className="muted tiny" style={{ padding: 12 }}>
              尚未解析到任何场次
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function TimelineRow({ row, last }: { row: ProgressRow | SceneRow; last: boolean }) {
  const state: RowState = (row as ProgressRow).state || "pending";
  const dotColor =
    state === "done"
      ? "var(--ok)"
      : state === "error"
      ? "var(--err)"
      : state === "ingesting"
      ? "var(--seal-500)"
      : "var(--ink-400)";
  const dotFill = state === "done" ? "var(--ok)" : state === "ingesting" ? "var(--seal-500)" : "transparent";
  const entities = (row as ProgressRow).entities || [];
  const edges = (row as ProgressRow).edges || 0;
  const tokens = (row as ProgressRow).tokens || 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: 12, paddingBottom: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: `1.5px solid ${dotColor}`,
            background: dotFill,
            marginTop: 5,
            boxShadow: "none",
            animation: state === "ingesting" ? "ingest-pulse 1.2s infinite" : "none",
          }}
        />
        {!last && (
          <div
            style={{
              flex: 1,
              width: 1,
              background: "var(--divider-strong)",
              marginTop: 2,
            }}
          />
        )}
      </div>
      <div style={{ paddingTop: 1 }}>
        <div className="row" style={{ gap: 8 }}>
          <span
            className="mono tiny"
            style={{ color: "var(--ink-500)", letterSpacing: 0 }}
          >
            E{String(row.ep).padStart(2, "0")} · S{String(row.sc).padStart(2, "0")}
          </span>
          <span
            className="tiny"
            style={{
              color:
                state === "done"
                  ? "var(--ok)"
                  : state === "error"
                  ? "var(--err)"
                  : state === "ingesting"
                  ? "var(--seal-400)"
                  : "var(--ink-500)",
                  letterSpacing: 0,
            }}
          >
            {state === "done"
              ? "已抽取"
              : state === "ingesting"
              ? "抽取中…"
              : state === "error"
              ? "出错"
              : "待导入"}
          </span>
        </div>
        <div
          className="song"
          style={{
            color: "var(--ink-800)",
            fontSize: 14,
            marginTop: 3,
            lineHeight: 1.5,
          }}
        >
          {row.body.slice(0, 46).replace(/\n/g, " ")}…
        </div>
        {state === "done" && entities.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {entities.map((e, k) => (
              <EntityPill key={k} kind={e.kind} name={e.name} />
            ))}
            <span className="tiny muted" style={{ padding: "2px 6px" }}>
              +{edges} 边{tokens ? ` · ${tokens}t` : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function EntityPill({ kind, name }: { kind: string; name: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    角色: { bg: "var(--ink-050)", fg: "var(--char-500)" },
    场景: { bg: "var(--ink-050)", fg: "var(--scene-500)" },
    事件: { bg: "var(--ink-050)", fg: "var(--event-500)" },
  };
  const c = colors[kind] || colors["角色"];
  return (
    <span
      className="song"
      style={{
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 0,
        background: c.bg,
        color: c.fg,
        border: "1px solid " + c.fg + "33",
      }}
    >
      <span className="tiny" style={{ marginRight: 4, color: c.fg, opacity: 0.7 }}>
        {kind}
      </span>
      {name}
    </span>
  );
}

function pickEntities(scene: SceneRow): { kind: string; name: string }[] {
  // Demo-only entity guessing when we're not hitting the real backend.
  const out: { kind: string; name: string }[] = [];
  const text = scene.body;
  const chars = ["李静", "张伟", "周雅静", "陈妈", "杨姝", "白芷"];
  const locs = ["咖啡馆", "仁济医院", "周家客厅", "阁楼", "餐厅", "档案室"];
  for (const n of chars) if (text.includes(n)) out.push({ kind: "角色", name: n });
  for (const l of locs) if (text.includes(l)) { out.push({ kind: "场景", name: l }); break; }
  const first = text.split(/[。\n]/)[0] || "";
  if (first) out.push({ kind: "事件", name: first.slice(0, 8) + (first.length > 8 ? "…" : "") });
  return out;
}

if (typeof document !== "undefined" && !document.getElementById("ingest-kf")) {
  const s = document.createElement("style");
  s.id = "ingest-kf";
  s.textContent = `@keyframes ingest-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }`;
  document.head.appendChild(s);
}
