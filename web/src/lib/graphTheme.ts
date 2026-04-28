// UniMem-style visual theme for the 3D graph view.
//
// Single source of truth for entity-type colors, link/particle/camera
// config used by ForceGraphPanel and the surrounding glass-morphism chrome.
// Replaces the per-entity --char-500/--beat-500/etc. lookup that the old
// 2D canvas used. Surrounding side panels still read those tokens for
// non-graph contexts; the graph itself now groups labels into 5 semantic
// categories matching UniMem's palette.

import type { NodeDTO } from "../types";

export type Category = "people" | "story" | "place" | "knowledge" | "misc";

export const CATEGORY_COLOR: Record<Category, string> = {
  people: "#74b9ff",
  story: "#fdcb6e",
  place: "#55efc4",
  knowledge: "#a29bfe",
  misc: "#dfe6e9",
};

export const CATEGORY_LABEL_ZH: Record<Category, string> = {
  people: "人物",
  story: "故事",
  place: "场所",
  knowledge: "认知",
  misc: "其他",
};

const ENTITY_CATEGORY: Record<string, Category> = {
  Character: "people",
  Identity: "people",
  Family: "people",
  Organization: "people",

  Beat: "story",
  Arc: "story",
  Theme: "story",
  PlotEvent: "story",
  Trope: "story",

  Scene: "place",
  Location: "place",

  Secret: "knowledge",
  Misunderstanding: "knowledge",
  Item: "knowledge",
};

// Generic labels Graphiti always attaches; carry no story meaning. Nodes
// that have ONLY these labels (no domain subtype) are bookkeeping noise
// — Graph.tsx drops them from the canvas unless `showInfra` is on.
export const GENERIC_LABELS = new Set(["Entity", "Episodic"]);

// Subset of labels that belong to the high-level (beat) ontology layer.
// Used by NodeInspector to switch UI sections and by FilterPanel to
// understand layer membership without needing to know the API layer
// param (which the inspector doesn't see).
export const HL_LABELS = new Set(["Beat", "Arc", "Theme", "Trope"]);

export type LayerKind = "hl" | "detail" | "generic";

// Classify a node into one of the three layer-kinds, regardless of which
// API layer (detail / hl / bridge) the request came from. A node with
// any HL label is "hl"; otherwise any non-generic label makes it
// "detail"; only-generic-labels nodes are "generic" infrastructure.
export function nodeLayerKind(node: Pick<NodeDTO, "labels">): LayerKind {
  for (const l of node.labels) {
    if (HL_LABELS.has(l)) return "hl";
  }
  for (const l of node.labels) {
    if (!GENERIC_LABELS.has(l)) return "detail";
  }
  return "generic";
}

export function categoryFor(node: Pick<NodeDTO, "labels">): Category {
  for (const label of node.labels) {
    if (GENERIC_LABELS.has(label)) continue;
    const cat = ENTITY_CATEGORY[label];
    if (cat) return cat;
  }
  return "misc";
}

export function colorFor(node: Pick<NodeDTO, "labels">): string {
  return CATEGORY_COLOR[categoryFor(node)];
}

// nodeVal in react-force-graph-3d is fed through cbrt then multiplied by
// nodeRelSize (default 4), so values returned here express relative
// importance — not raw radii. Values land in roughly 4–18 to keep the
// 2D version's hierarchy (Arc largest, Identity small).
export function sizeFor(node: NodeDTO): number {
  const tension = node.properties.tension_level as number | undefined;
  if (typeof tension === "number") return 4 + tension * 1.4;
  if (node.labels.includes("Arc")) return 16;
  if (node.labels.includes("Character")) return 12;
  if (node.labels.includes("Theme")) return 11;
  if (node.labels.includes("Family")) return 9;
  if (node.labels.includes("Trope")) return 9;
  if (node.labels.includes("Organization")) return 8;
  if (node.labels.includes("Misunderstanding")) return 7;
  if (node.labels.includes("Secret")) return 7;
  if (node.labels.includes("Beat")) return 7;
  if (node.labels.includes("Identity")) return 5;
  if (node.labels.includes("Item")) return 5;
  if (node.labels.includes("Location")) return 5;
  if (node.labels.includes("Scene")) return 5;
  return 6;
}

// Edge / particle / camera constants match UniMem's graph-page.tsx.
export const LINK = {
  color: "rgba(180,200,255,0.35)",
  width: 1.5,
  opacity: 0.6,
  particles: 1,
  particleWidth: 1.2,
  particleSpeed: 0.004,
  particleColor: "rgba(180,200,255,0.6)",
};

export const SCENE = {
  background: "#0a0a0a",
};
