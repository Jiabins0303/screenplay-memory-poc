// Thin fetch wrapper + SSE helper against the FastAPI backend.
// Base URL: VITE_API_BASE at build time OR localStorage.apiBase at runtime.
//
// In DEMO_ONLY mode (static GitHub Pages build) we intercept a known set of
// GET endpoints and return the baked snapshot from `mockdata.bazong.ts`
// instead of hitting the network. Anything we don't have a mock for falls
// back to the original "未连接后端" error so the user gets a clear signal
// that the action isn't available in the static demo.

import { fetchEventSource } from "@microsoft/fetch-event-source";
import { DEMO_ONLY } from "./env";
import {
  MOCK_BAZONG_BOUNDARY,
  MOCK_BAZONG_GRAPHS,
  MOCK_BAZONG_PROJECT,
  MOCK_BAZONG_SOURCE_SCENES,
} from "./mockdata.bazong";

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

// Return mock data for known GET paths in DEMO_ONLY mode. Returns ``null``
// if there is no mock for the requested path, in which case ``request``
// falls through to the "未连接后端" error.
function demoMockResponse(method: string, path: string): unknown | null {
  if (method !== "GET") return null;
  // Strip the query string for matching but keep it parsed for layer pickers.
  const [bare, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);

  if (bare === "/projects") {
    return [MOCK_BAZONG_PROJECT];
  }
  if (bare === "/projects/bazong_demo/graph") {
    const layer = (params.get("layer") || "detail") as keyof typeof MOCK_BAZONG_GRAPHS;
    return MOCK_BAZONG_GRAPHS[layer] ?? MOCK_BAZONG_GRAPHS.detail;
  }
  if (bare === "/projects/bazong_demo/boundary") {
    return MOCK_BAZONG_BOUNDARY;
  }
  if (bare === "/projects/bazong_demo/ingest/source-scenes") {
    return MOCK_BAZONG_SOURCE_SCENES;
  }
  return null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (DEMO_ONLY) {
    const mock = demoMockResponse(method, path);
    if (mock !== null) {
      return mock as T;
    }
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
