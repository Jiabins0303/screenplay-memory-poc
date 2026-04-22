import { useState } from "react";
import { api } from "../api";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

interface Props {
  projectId: string;
}

export default function Chat({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const q = input.trim();
    if (!q) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api.post<{ mode: string; results?: unknown[]; result?: unknown }>(
        `/projects/${projectId}/query`,
        { mode: "search", question: q },
      );
      const reply = JSON.stringify(res.results ?? res.result ?? res, null, 2);
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `错误：${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`fixed bottom-4 right-4 w-96 bg-slate-900 border border-slate-700 rounded shadow-lg text-sm z-40 ${
        open ? "h-96" : "h-10"
      } flex flex-col`}
    >
      <button
        className="flex items-center px-3 py-2 border-b border-slate-800 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold">对话查询</span>
        <span className="ml-auto text-slate-500 text-xs">
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open && (
        <>
          <div className="flex-1 overflow-auto p-3 space-y-2 text-xs">
            {messages.length === 0 && (
              <div className="text-slate-500">
                问一个关于当前剧本的问题，比如「张伟何时知道领养的事？」
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <div className={m.role === "user" ? "text-sky-400" : "text-slate-300"}>
                  {m.role === "user" ? "你" : "助手"}
                </div>
                <pre className="whitespace-pre-wrap break-words bg-slate-950 p-2 rounded mt-1">
                  {m.text}
                </pre>
              </div>
            ))}
          </div>
          <div className="flex gap-2 p-2 border-t border-slate-800">
            <input
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="输入问题 ⏎ 发送"
            />
            <button
              className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3 rounded"
              onClick={send}
              disabled={busy}
            >
              发送
            </button>
          </div>
        </>
      )}
    </div>
  );
}
