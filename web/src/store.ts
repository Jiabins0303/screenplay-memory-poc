// Global UI state. Keep it tiny: the current project id + derived selectors.

import { create } from "zustand";

interface UIState {
  projectId: string | null;
  setProject: (pid: string | null) => void;
  apiBase: string;
  setApiBase: (url: string) => void;
}

export const useUI = create<UIState>((set) => ({
  projectId: localStorage.getItem("projectId") || null,
  setProject: (pid) => {
    if (pid) localStorage.setItem("projectId", pid);
    else localStorage.removeItem("projectId");
    set({ projectId: pid });
  },
  apiBase: localStorage.getItem("apiBase") || "http://localhost:8000",
  setApiBase: (url) => {
    localStorage.setItem("apiBase", url.replace(/\/$/, ""));
    set({ apiBase: url });
  },
}));
