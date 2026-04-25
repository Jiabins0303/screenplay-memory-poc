// Thin fetch wrapper + SSE helper against the FastAPI backend.
// Base URL: VITE_API_BASE at build time OR localStorage.apiBase at runtime.

import { fetchEventSource } from "@microsoft/fetch-event-source";
import { DEMO_ONLY } from "./env";

const BUILD_TIME_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "";

export function apiBase(): string {
  try {
    const saved = localStorage.getItem("apiBase");
    if (saved) return saved.replace(/\/$/, "");
  } catch {
    // ignore storage access errors (private mode, SSR, etc.)
  }
  return (BUILD_TIME_BASE || "http://localhost:8000").replace(/\/$/, "");
}

export function setApiBase(url: string): void {
  localStorage.setItem("apiBase", url.replace(/\/$/, ""));
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (DEMO_ONLY) {
    throw new Error("当前是静态演示版本，未连接后端。");
  }
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T,>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T,>(path: string) => request<T>("DELETE", path),
};

// SSE ingest — EventSource is GET-only, so we use fetch-event-source for POST.
export interface IngestEvent {
  event: string;
  data: Record<string, unknown>;
}

export async function streamIngest(
  projectId: string,
  payload: unknown,
  onEvent: (ev: IngestEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (DEMO_ONLY) {
    throw new Error("当前是静态演示版本，未连接后端。");
  }
  await fetchEventSource(`${apiBase()}/projects/${projectId}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
    onmessage(msg) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = msg.data ? JSON.parse(msg.data) : {};
      } catch {
        parsed = { raw: msg.data };
      }
      onEvent({ event: msg.event || "message", data: parsed });
    },
    onerror(err) {
      throw err;
    },
    // Keep-alive across tabs even if the user switches; useful on long ingests.
    openWhenHidden: true,
  });
}
