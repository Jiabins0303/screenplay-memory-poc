// Right-side settings drawer for backend connection options.

import { useEffect, useState } from "react";
import { useUI } from "../store";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function Settings({ open, onClose }: Props) {
  const apiBase = useUI((s) => s.apiBase);
  const setApiBase = useUI((s) => s.setApiBase);
  const [draft, setDraft] = useState(apiBase);

  // Reset draft whenever the drawer reopens so previous cancelled edits
  // don't silently hang around in the input.
  useEffect(() => {
    if (open) setDraft(apiBase);
  }, [open, apiBase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease",
          zIndex: 69,
          backdropFilter: open ? "blur(2px)" : "none",
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: 420,
          maxWidth: "92vw",
          background: "var(--ink-100)",
          borderLeft: "1px solid var(--divider-strong)",
          boxShadow: "var(--shadow-float)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
          zIndex: 70,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "22px 26px 16px",
            borderBottom: "1px solid var(--divider)",
            display: "flex",
            alignItems: "baseline",
            gap: 12,
          }}
        >
          <div>
            <div className="kicker" style={{ marginBottom: 4 }}>
              设置
            </div>
            <div
              style={{
                fontSize: 18,
                color: "var(--ink-900)",
                fontWeight: 700,
              }}
            >
              后端连接
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            className="btn sm ghost"
            aria-label="关闭"
          >
            关闭
          </button>
        </header>

        <div style={{ padding: "20px 26px", flex: 1, overflow: "auto" }}>
          <label
            className="kicker"
            htmlFor="settings-api-base"
            style={{ display: "block", marginBottom: 8 }}
          >
            API 地址
          </label>
          <input
            id="settings-api-base"
            className="input mono"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="http://localhost:8000"
            autoFocus
          />
          <div
            className="song"
            style={{
              fontSize: 12.5,
              color: "var(--ink-500)",
              marginTop: 10,
              lineHeight: 1.75,
              paddingLeft: 10,
              borderLeft: "2px solid var(--divider-strong)",
            }}
          >
            后端默认跑在本机 8000 端口。若需要通过 Cloudflare Pages 访问，
            先在本地启动 <code
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--seal-400)",
              }}
            >
              docker compose up
            </code>
            ，再把此项改为 <code
              style={{ fontFamily: "var(--font-mono)" }}
            >
              http://localhost:8000
            </code>
            。
          </div>
        </div>

        <footer
          style={{
            padding: "16px 26px 22px",
            borderTop: "1px solid var(--divider)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            background: "var(--ink-050)",
          }}
        >
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setApiBase(draft);
              onClose();
            }}
          >
            保存
          </button>
        </footer>
      </aside>
    </>
  );
}
