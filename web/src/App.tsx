// Top-level app shell. Routing is intentionally state-driven (not
// react-router) to match the design's single-screen-at-a-time model; each
// tab owns its entire viewport and the URL doesn't need to reflect the
// active tab for a demo-first build.

import { useState } from "react";
import { DEMO_ONLY } from "./env";
import { useUI } from "./store";
import TopNav from "./components/TopNav";
import Settings from "./components/Settings";
import ProjectsPage from "./pages/Projects";
import OntologyPage from "./pages/OntologyEditor";
import IngestPage from "./pages/Ingest";
import GraphPage from "./pages/Graph";
import BoundaryPage from "./pages/Boundary";
import ChatPopover from "./components/Chat";

export default function App() {
  const route = useUI((s) => s.route);
  const project = useUI((s) => s.project);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const effectiveRoute = project ? route : "projects";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TopNav onSettings={() => setSettingsOpen(true)} />
      <main style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {effectiveRoute === "projects" && <ProjectsPage />}
        {effectiveRoute === "ontology" && <OntologyPage />}
        {effectiveRoute === "ingest" && <IngestPage />}
        {effectiveRoute === "graph" && <GraphPage />}
        {effectiveRoute === "boundary" && <BoundaryPage />}
      </main>
      {project && effectiveRoute !== "projects" && <ChatPopover />}
      {!DEMO_ONLY && <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
