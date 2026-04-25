// 对话查询 · structured boundary answers from the knowledge graph.
// Shows quick-ask chips, user bubbles on the right, assistant bubbles on
// the left. If the question matches a MOCK seed (demo project), we render
// a rich "boundary result" card with character/fact/beat/trace chips;
// otherwise we hit POST /query on the real backend.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DEMO_ONLY } from "../env";
import { useUI } from "../store";
import { MOCK_CHAT_SEED, findBeat, findCharacter, findFact, findScene } from "../mockdata";

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; kind: "welcome" }
  | { role: "assistant"; kind: "generic"; text: string }
  | {
      role: "assistant";
      kind: "boundary";
      fact: string;
      character: string;
      atBeat: string;
      summary: string;
      trace: string[];
    };

const QUICK_ASKS_DEMO = [
  "张伟何时知道领养的事？",
  "周雅静知道张伟知情吗？",
];

const QUICK_ASKS_REAL = [
  "剧中有哪些关键事件？",
  "主角和对立角色的关系？",
];

export default function ChatPopover() {
  const project = useUI((s) => s.project);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", kind: "welcome" }]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  if (!project) return null;
  const isDemo = DEMO_ONLY || project.demo;
  const projectId = project.id;

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setMsgs((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setBusy(true);
    try {
      if (isDemo) {
        await new Promise((r) => setTimeout(r, 600 + Math.random() * 300));
        const seed = MOCK_CHAT_SEED.find((s) => trimmed.includes(s.q.slice(0, 4)));
        if (seed) {
          setMsgs((m) => [
            ...m,
            { role: "assistant", kind: "boundary", ...seed.a },
          ]);
        } else {
          setMsgs((m) => [
            ...m,
            {
              role: "assistant",
              kind: "generic",
              text: `（示例回答）根据当前节拍层推理，「${trimmed.slice(0, 16)}」可以追溯到多个场次。示例模式下仅对预设问题给出结构化答案。`,
            },
          ]);
        }
      } else {
        const res = await api.post<{
          mode: string;
          results?: { fact?: string; valid_at?: string }[];
        }>(`/projects/${projectId}/query`, {
          mode: "search",
          question: trimmed,
        });
        const facts = (res.results || [])
          .map((r) => r.fact)
          .filter((f): f is string => !!f)
          .slice(0, 5);
        if (facts.length === 0) {
          setMsgs((m) => [
            ...m,
            {
              role: "assistant",
              kind: "generic",
              text: "未检索到相关信息。可以在「图谱」页查看当前项目的实体分布。",
            },
          ]);
        } else {
          setMsgs((m) => [
            ...m,
            {
              role: "assistant",
              kind: "generic",
              text: "找到 " + facts.length + " 条相关事实：\n\n" +
                facts.map((f, i) => `${i + 1}. ${f}`).join("\n"),
            },
          ]);
        }
      }
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "assistant", kind: "generic", text: `查询失败：${String(e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          background: "var(--ink-900)",
          color: "#fff",
          borderRadius: 0,
          boxShadow: "var(--shadow-float)",
          zIndex: 40,
          border: "none",
          cursor: "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        智能查询
      </button>
    );
  }

  const prompts = isDemo ? QUICK_ASKS_DEMO : QUICK_ASKS_REAL;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        width: 420,
        height: 540,
        background: "var(--ink-100)",
        borderRadius: 0,
        border: "1px solid var(--divider-strong)",
        boxShadow: "var(--shadow-float)",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--divider)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--ink-050)",
        }}
      >
        <div>
          <div style={{ fontSize: 14, color: "var(--ink-900)", fontWeight: 700 }}>
            智能查询
          </div>
          <div className="tiny muted">
            {isDemo ? "示例数据" : "基于知识图谱检索"}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={() => setOpen(false)}>
          关闭
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
        {msgs.map((m, i) => (
          <ChatMsg key={i} m={m} />
        ))}
        {busy && (
          <div className="tiny muted" style={{ padding: 8 }}>
            正在检索…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div
        style={{
          padding: 10,
          borderTop: "1px solid var(--divider)",
          background: "var(--ink-050)",
        }}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {prompts.map((s) => (
            <button
              key={s}
              className="chip"
              onClick={() => ask(s)}
              style={{ cursor: "pointer", fontSize: 11.5 }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input song"
            value={input}
            placeholder="问一个关于这部剧的问题…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(input)}
          />
          <button
            className="btn primary"
            onClick={() => ask(input)}
            disabled={busy || !input.trim()}
          >
            送出
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMsg({ m }: { m: Msg }) {
  if (m.role === "assistant" && m.kind === "welcome") {
    return (
      <div style={{ padding: "8px 4px 16px" }}>
        <div style={{ fontSize: 14.5, color: "var(--ink-900)", lineHeight: 1.7, fontWeight: 650 }}>
          输入问题以查询当前项目。
        </div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          回答会基于已抽取的角色、场景、事件和知识边界。
        </div>
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <div
          style={{
            background: "var(--ink-900)",
            color: "#fff",
            padding: "8px 12px",
            borderRadius: 0,
            maxWidth: 280,
            fontSize: 13.5,
          }}
        >
          {m.text}
        </div>
      </div>
    );
  }
  if (m.kind === "boundary") {
    const fact = findFact(m.fact);
    const char = findCharacter(m.character);
    const beat = findBeat(m.atBeat);
    return (
      <div
        style={{
          marginBottom: 12,
          padding: "12px 14px",
          background: "var(--ink-050)",
          borderRadius: 0,
          border: "1px solid var(--divider)",
          borderLeft: "3px solid #e4002b",
        }}
      >
        <div className="tiny muted" style={{ marginBottom: 6 }}>
          知识边界查询
        </div>
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.8,
            color: "var(--ink-800)",
            marginBottom: 10,
          }}
        >
          {m.summary}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {char && <span className="chip">{char.name}</span>}
          {fact && <span className="chip hot">{fact.text}</span>}
          {beat && <span className="chip">于 {beat.label}</span>}
        </div>
        <div className="tiny muted">
          证据场次
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          {m.trace.map((sid) => {
            const s = findScene(sid);
            return (
              s && (
                <span
                  key={sid}
                  className="chip mono"
                  style={{ fontSize: 11 }}
                >
                  E{s.ep}·S{s.sc} {s.title}
                </span>
              )
            );
          })}
        </div>
      </div>
    );
  }
  // generic
  return (
    <div
      style={{
        marginBottom: 10,
        padding: "10px 12px",
        background: "var(--ink-050)",
        borderRadius: 0,
        fontSize: 13.5,
        color: "var(--ink-800)",
        lineHeight: 1.8,
        whiteSpace: "pre-wrap",
      }}
    >
      {"text" in m ? m.text : ""}
    </div>
  );
}
