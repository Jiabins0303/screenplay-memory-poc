// Demo data referenced by the design system. The bulk of the legacy "回响"
// fixtures lived here previously; with the static GitHub Pages demo we
// snapshot the real `bazong_demo` project instead (see `mockdata.bazong.ts`).
//
// What's left below are the lookup tables that real-data pages still need —
// kind labels and colors used by the graph filter rail and node inspector,
// plus the role-zh map referenced by NodeInspector for `role_type` chips.

import { MOCK_BAZONG_PROJECT } from "./mockdata.bazong";

export interface MockProject {
  id: string;
  title: string;
  ep: number;
  scenes: number;
  updated: string;
  status: string;
  genre: string;
  lead: string;
  demo?: boolean;
}

// Single-entry list now: bazong_demo is the only thing the static demo
// surface should expose. The Projects page no longer ships placeholder
// case-files; the live mode rebuilds the list from the backend.
export const MOCK_PROJECTS: MockProject[] = [
  {
    id: MOCK_BAZONG_PROJECT.project_id,
    title: "巴中往事 · 示例",
    ep: 1,
    scenes: 8,
    updated: (MOCK_BAZONG_PROJECT.created_at || "").slice(0, 10) || "2026-04-26",
    status: "演示",
    genre: "都市 · 群像",
    lead: "示例项目",
    demo: true,
  },
];

// Re-export the snapshot bundle so consumers can import everything from
// `./mockdata` if they prefer; the snapshot module is the source of truth
// for the bazong project data.
export {
  MOCK_BAZONG_PROJECT,
  MOCK_BAZONG_GRAPHS,
  MOCK_BAZONG_BOUNDARY,
  MOCK_BAZONG_SOURCE_SCENES,
} from "./mockdata.bazong";

// Ontology types — lightweight mirror of OntologySpec used by the demo
// editor. The static OntologyEditor renders these read-only when DEMO_ONLY
// since there is no backend to PUT changes to.

export interface MockOntologyField {
  name: string;
  type: string;
  opt: boolean;
  note?: string;
  vals?: string[];
}

export interface MockOntologyEntity {
  name: string;
  desc: string;
  fields: MockOntologyField[];
}

export interface MockOntology {
  entities: MockOntologyEntity[];
  edges: MockOntologyEntity[];
}

export const MOCK_ONTOLOGY_DETAIL: MockOntology = {
  entities: [
    {
      name: "Character",
      desc: "出场人物。包含主角、配角、隐身叙事角色。",
      fields: [
        { name: "name", type: "str", opt: false, note: "人物本名，不含昵称" },
        {
          name: "role_type",
          type: "literal",
          vals: ["protagonist", "antagonist", "support", "ghost"],
          opt: false,
        },
        { name: "age", type: "int", opt: true },
        { name: "aliases", type: "list[str]", opt: true, note: "别名与昵称" },
      ],
    },
    {
      name: "Scene",
      desc: "剧本中的单场戏。按「第X集第Y场」切分。",
      fields: [
        { name: "episode_number", type: "int", opt: false },
        { name: "scene_number", type: "int", opt: false },
        { name: "loc_name", type: "str", opt: true },
        {
          name: "loc_type",
          type: "literal",
          vals: ["室内", "室外"],
          opt: true,
        },
      ],
    },
    {
      name: "PlotEvent",
      desc: "推动剧情的具体事件。",
      fields: [
        { name: "event_summary", type: "str", opt: false, note: "一句话描述" },
        { name: "significance", type: "int", opt: true },
      ],
    },
  ],
  edges: [
    { name: "ScreenplayRelation", desc: "通用剧本关系", fields: [] },
    { name: "KnowsSecret", desc: "角色在某时刻得知某秘密", fields: [] },
    { name: "BelievesAbout", desc: "角色对某人/事的看法", fields: [] },
  ],
};

export const MOCK_ONTOLOGY_HL: MockOntology = {
  entities: [
    {
      name: "Beat",
      desc: "叙事节拍，三幕结构中的一个转折点。",
      fields: [
        {
          name: "beat_type",
          type: "literal",
          vals: [
            "Setup",
            "Inciting",
            "Dilemma",
            "Investigation",
            "Conflict",
            "Discovery",
            "Revelation",
            "Climax",
            "Resolution",
            "Coda",
          ],
          opt: false,
        },
        { name: "tension_level", type: "int", opt: false, note: "1–10 张力值" },
      ],
    },
    { name: "Arc", desc: "人物弧光 / 叙事线。", fields: [] },
    { name: "Theme", desc: "主题母题。", fields: [{ name: "theme_name", type: "str", opt: false }] },
  ],
  edges: [
    { name: "BeatRelation", desc: "节拍间的时序与归属关系", fields: [] },
  ],
};

// Role label lookup used by NodeInspector and Boundary's character chips.
// These are stable across mock + real data because role_type values come
// from the ontology Literal[...] field; keeping the map here avoids a
// per-page redefinition.
export const ROLE_ZH: Record<string, string> = {
  protagonist: "主角",
  antagonist: "对立",
  support: "支撑",
  foil: "对照",
  catalyst: "推手",
  ghost: "亡者",
};

// Entity-kind labels, stable across design + data.
export const KIND_ZH: Record<string, string> = {
  Character: "角色",
  Scene: "场景",
  PlotEvent: "事件",
  Beat: "节拍",
  Arc: "弧光",
  Theme: "主题",
  Identity: "身份",
  Family: "家族",
  Organization: "组织",
  Location: "场所",
  Item: "道具",
  Misunderstanding: "误会",
  Secret: "秘密",
  Trope: "套路",
};

export const KIND_COLOR: Record<string, string> = {
  Character: "--char-500",
  Scene: "--scene-500",
  PlotEvent: "--event-500",
  Beat: "--beat-500",
  Arc: "--arc-500",
  Theme: "--theme-500",
};
