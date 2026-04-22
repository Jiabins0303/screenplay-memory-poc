import { useState } from "react";
import { useUI } from "../store";
import { setApiBase } from "../api";

export default function Settings() {
  const [open, setOpen] = useState(false);
  const base = useUI((s) => s.apiBase);
  const setBase = useUI((s) => s.setApiBase);
  const [draft, setDraft] = useState(base);

  return (
    <>
      <button
        className="text-xs text-slate-400 hover:text-slate-200"
        onClick={() => {
          setDraft(base);
          setOpen(true);
        }}
      >
        设置
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded p-6 w-96"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold mb-3">后端 API 地址</div>
            <input
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="http://localhost:8000"
            />
            <div className="text-xs text-slate-500 mt-2">
              后端默认跑在本机 8000 端口。需要通过 Cloudflare Pages 访问时，
              先在本地启动 docker compose up，再把此项改为 http://localhost:8000。
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="text-sm text-slate-400"
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <button
                className="text-sm bg-sky-600 hover:bg-sky-500 px-3 py-1 rounded"
                onClick={() => {
                  setBase(draft);
                  setApiBase(draft);
                  setOpen(false);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
