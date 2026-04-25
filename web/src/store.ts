// Global UI state: current route, active project, and API base URL.
//
// Everything persists to localStorage so refreshing the page lands on the
// same tab with the same project selected. This matches the design's shell
// behaviour and also keeps demo projects sticky once a user opens one.

import { create } from "zustand";
import { DEMO_ONLY } from "./env";

export type Route = "projects" | "ontology" | "ingest" | "graph" | "boundary";

export interface ActiveProject {
  id: string;
  title: string;
  demo?: boolean; // true when the project is sourced from MOCK_PROJECTS
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

interface UIState {
  route: Route;
  setRoute: (r: Route) => void;

  project: ActiveProject | null;
  setProject: (p: ActiveProject | null) => void;

  apiBase: string;
  setApiBase: (url: string) => void;
}

export const useUI = create<UIState>((set) => ({
  route: (localStorage.getItem("route") as Route) || "projects",
  setRoute: (r) => {
    localStorage.setItem("route", r);
    set({ route: r });
  },

  project: loadJSON<ActiveProject | null>("project", null),
  setProject: (p) => {
    if (p) localStorage.setItem("project", JSON.stringify(p));
    else localStorage.removeItem("project");
    set({ project: p });
  },

  apiBase: DEMO_ONLY ? "" : localStorage.getItem("apiBase") || "http://localhost:8000",
  setApiBase: (url) => {
    if (DEMO_ONLY) return;
    const clean = url.replace(/\/$/, "");
    localStorage.setItem("apiBase", clean);
    set({ apiBase: clean });
  },
}));
