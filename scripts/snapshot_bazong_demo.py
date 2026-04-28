"""Snapshot the live `bazong_demo` project from the local API into a static
TypeScript module so the web frontend can run as a zero-backend demo on
GitHub Pages.

Usage (with the API + Neo4j up at http://localhost:8000):

    .venv/bin/python scripts/snapshot_bazong_demo.py

The output is `web/src/mockdata.bazong.ts`. Re-run whenever the underlying
graph changes; the GitHub Pages workflow rebuilds Vite from this file alone.

Layout: positions are baked at snapshot time using `networkx.spring_layout`
with a deterministic seed so the demo opens with a settled graph instead of
the jittery presettle animation. The frontend's `ForceGraphPanel` checks
`properties.layout_x / layout_y` and skips physics when they are present.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import httpx
import networkx as nx

API_BASE = "http://localhost:8000"
PROJECT_ID = "bazong_demo"
LAYERS = ("detail", "hl", "bridge")

# Generic Graphiti labels excluded from the per-label tally — they ride
# on every node and would dominate the "observed types" histogram.
GENERIC_LABELS = {"Entity", "Episodic"}

# Canvas-ish dimensions used by the React force-graph panel. Multiplying
# spring_layout's [-1, 1] coords by these gives positions that look good
# centered on the canvas without further normalization.
CANVAS_W = 1200
CANVAS_H = 900

OUT_PATH = Path(__file__).resolve().parent.parent / "web" / "src" / "mockdata.bazong.ts"


def fetch_json(client: httpx.Client, path: str) -> Any:
    res = client.get(f"{API_BASE}{path}", timeout=30.0)
    res.raise_for_status()
    return res.json()


def strip_embeddings(obj: Any) -> Any:
    """Defensively strip `*_embedding` keys from nested dicts. The API already
    drops these but we double-check so a backend regression can't quietly
    bloat the static bundle to MBs of float arrays."""
    if isinstance(obj, dict):
        return {
            k: strip_embeddings(v)
            for k, v in obj.items()
            if not (isinstance(k, str) and k.endswith("_embedding"))
        }
    if isinstance(obj, list):
        return [strip_embeddings(x) for x in obj]
    return obj


def bake_layout(graph: dict[str, Any]) -> dict[str, Any]:
    """Compute deterministic spring-layout positions and inject them into
    each node's `properties` as `layout_x` / `layout_y` (plain floats).

    Empty graphs (e.g. a bridge layer with no edges) skip layout — the
    frontend's all-positioned check naturally falls back to the live
    presettle code path in that case, which handles zero nodes cleanly."""
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    if not nodes:
        return graph

    g = nx.Graph()
    for n in nodes:
        g.add_node(n["uuid"])
    for e in edges:
        if e.get("source") and e.get("target"):
            g.add_edge(e["source"], e["target"])

    # spring_layout spreads N nodes such that average edge length ≈ k. With
    # k=1/sqrt(N) and 500 iters, the layout converges nicely for graphs in
    # the 50-300 node range we expect here.
    n_count = max(1, len(g))
    pos = nx.spring_layout(g, k=1.0 / math.sqrt(n_count), iterations=500, seed=42)

    for n in nodes:
        p = pos.get(n["uuid"])
        if p is None:
            continue
        x, y = float(p[0]), float(p[1])
        props = n.setdefault("properties", {})
        props["layout_x"] = x * CANVAS_W
        props["layout_y"] = y * CANVAS_H

    return graph


def main() -> None:
    with httpx.Client() as client:
        # Project metadata — pluck the bazong entry from /projects so we
        # carry whatever created_at the live DB has.
        projects = fetch_json(client, "/projects")
        project_entry = next(
            (p for p in projects if p.get("project_id") == PROJECT_ID),
            {"project_id": PROJECT_ID, "created_at": None},
        )

        graphs = {}
        for layer in LAYERS:
            raw = fetch_json(client, f"/projects/{PROJECT_ID}/graph?layer={layer}")
            cleaned = strip_embeddings(raw)
            graphs[layer] = bake_layout(cleaned)

        boundary = strip_embeddings(fetch_json(client, f"/projects/{PROJECT_ID}/boundary"))
        source_scenes = strip_embeddings(
            fetch_json(client, f"/projects/{PROJECT_ID}/ingest/source-scenes")
        )

    project_info = {
        "project_id": project_entry.get("project_id", PROJECT_ID),
        "created_at": project_entry.get("created_at"),
    }

    # Tally non-generic labels per layer so the OntologyEditor's "observed
    # types" panel can flag schema gaps (label appears in data but not in
    # the curated MOCK_ONTOLOGY) without re-walking thousands of nodes at
    # render time.
    observed: dict[str, dict[str, int]] = {}
    for layer in LAYERS:
        tally: dict[str, int] = {}
        for n in graphs[layer].get("nodes", []):
            for label in n.get("labels", []):
                if label in GENERIC_LABELS:
                    continue
                tally[label] = tally.get(label, 0) + 1
        observed[layer] = dict(sorted(tally.items(), key=lambda kv: (-kv[1], kv[0])))

    # Embed the data as a JSON.parse() of a single string literal. This sidesteps
    # the as-const narrowing pain on `properties: Record<string, unknown>` —
    # tsc just sees the typed export, and parse happens once at module load.
    project_json = json.dumps(project_info, ensure_ascii=False)
    graphs_json = json.dumps(graphs, ensure_ascii=False)
    boundary_json = json.dumps(boundary, ensure_ascii=False)
    scenes_json = json.dumps(source_scenes, ensure_ascii=False)
    observed_json = json.dumps(observed, ensure_ascii=False)

    # Escape backticks and ${ for safe template-literal embedding.
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

    content = f"""// GENERATED by scripts/snapshot_bazong_demo.py — DO NOT EDIT
// Snapshot of the live `bazong_demo` project for static GitHub Pages demo.
// Re-run the script after the graph changes; positions are baked here so
// the force layout opens settled instead of mid-animation.

import type {{ GraphDTO, ProjectInfo }} from "./types";

interface BoundarySnapshot {{
  characters: {{ uuid: string; name: string }}[];
  beats: {{
    uuid: string;
    label: string;
    type: string;
    tension: number;
    episode: number;
    scene_end_ep: number;
    scene_end_sc: number;
  }}[];
  facts: string[];
  knowledge: Record<string, Record<string, string[]>>;
  latest: Record<string, {{ fact: string; beat_uuid: string }} | null>;
}}

interface SourceScenesPayload {{
  scenes: {{ episode_number: number; scene_number: number; content: string }}[];
}}

export const MOCK_BAZONG_PROJECT: ProjectInfo = JSON.parse(
  `{esc(project_json)}`,
);

export const MOCK_BAZONG_GRAPHS: {{
  detail: GraphDTO;
  hl: GraphDTO;
  bridge: GraphDTO;
}} = JSON.parse(
  `{esc(graphs_json)}`,
);

export const MOCK_BAZONG_BOUNDARY: BoundarySnapshot = JSON.parse(
  `{esc(boundary_json)}`,
);

export const MOCK_BAZONG_SOURCE_SCENES: SourceScenesPayload = JSON.parse(
  `{esc(scenes_json)}`,
);

// Per-layer histogram of non-generic node labels actually present in the
// snapshot. Used by OntologyEditor's "observed types" panel to flag
// schema gaps (label appears in data but not in MOCK_ONTOLOGY).
export const BAZONG_OBSERVED_LABELS: Record<"detail" | "hl" | "bridge", Record<string, number>> = JSON.parse(
  `{esc(observed_json)}`,
);
"""

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(content, encoding="utf-8")

    sizes = {layer: (len(graphs[layer]["nodes"]), len(graphs[layer]["edges"])) for layer in LAYERS}
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes)")
    for layer, (n, e) in sizes.items():
        print(f"  {layer}: {n} nodes, {e} edges")
    print(f"  boundary: {len(boundary.get('characters', []))} chars, "
          f"{len(boundary.get('beats', []))} beats, {len(boundary.get('facts', []))} facts")
    print(f"  source_scenes: {len(source_scenes.get('scenes', []))} scenes")


if __name__ == "__main__":
    main()
