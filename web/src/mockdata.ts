// Demo data used when the backend has nothing to show.
// Ported from the design bundle's mockdata.jsx ("回响 / Echoes" — 12-episode
// family-mystery drama). A real project with ingested data shadows these
// values, but until the user creates one the UI stays populated so the
// visual design isn't marooned on empty state.

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

export interface MockCharacter {
  id: string;
  name: string;
  alias: string[];
  role: "protagonist" | "antagonist" | "support" | "foil" | "catalyst" | "ghost";
  age: number;
  note: string;
}

export interface MockScene {
  id: string;
  ep: number;
  sc: number;
  title: string;
  loc: string;
  time: string;
  summary: string;
  present: string[];
  beats: string[];
}

export interface MockBeat {
  id: string;
  ep: number;
  tension: number;
  type: string;
  label: string;
  desc: string;
}

export interface MockFact {
  id: string;
  text: string;
  revealBeat: string;
}

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

export interface MockChatSeed {
  q: string;
  a: {
    fact: string;
    character: string;
    atBeat: string;
    summary: string;
    trace: string[];
  };
}

export const MOCK_PROJECTS: MockProject[] = [
  { id: "echoes-2026",  title: "回响",       ep: 12, scenes: 83, updated: "2026-04-18", status: "进行中", genre: "家庭 · 悬疑", lead: "编剧 · 陆清", demo: true },
  { id: "after-rain",   title: "雨后",       ep: 8,  scenes: 56, updated: "2026-04-09", status: "初稿",   genre: "爱情 · 都市", lead: "编剧 · 徐怀", demo: true },
  { id: "north-wind",   title: "北风与海",   ep: 20, scenes: 142,updated: "2026-03-28", status: "修订",   genre: "年代 · 群像", lead: "编剧 · 江予", demo: true },
  { id: "attic-letter", title: "阁楼里的信", ep: 6,  scenes: 41, updated: "2026-02-15", status: "完稿",   genre: "悬疑 · 短剧", lead: "编剧 · 苏怿", demo: true },
];

export const MOCK_CHARACTERS: MockCharacter[] = [
  { id: "c-lijing",      name: "李静",   alias: ["静姐"],    role: "protagonist", age: 28, note: "自由撰稿人。三十岁生日前收到匿名信，得知自己是被领养的。" },
  { id: "c-zhangwei",    name: "张伟",   alias: [],          role: "foil",        age: 32, note: "李静的丈夫，大学历史讲师。先于李静知悉真相。" },
  { id: "c-zhouyajing",  name: "周雅静", alias: ["阿姨"],    role: "antagonist",  age: 55, note: "李静的养母。为保护李静隐瞒真相二十余年。" },
  { id: "c-chenma",      name: "陈妈",   alias: [],          role: "support",     age: 62, note: "周家旧仆，知情者。" },
  { id: "c-yangshu",     name: "杨姝",   alias: ["杨医生"],  role: "catalyst",    age: 45, note: "当年医院的妇产科医生。" },
  { id: "c-lijingbirth", name: "白芷",   alias: ["生母"],    role: "ghost",       age: 0,  note: "李静的生母，1998 年难产去世。" },
];

export const MOCK_SCENES: MockScene[] = [
  { id: "s-1-1",  ep: 1, sc: 1, title: "咖啡馆的信",       loc: "静咖啡馆",    time: "日·内", summary: "李静走进咖啡馆，看到张伟已在角落。桌上有一封没署名的信。", present: ["c-lijing", "c-zhangwei"], beats: ["b-inciting"] },
  { id: "s-1-2",  ep: 1, sc: 2, title: "独坐",             loc: "静咖啡馆",    time: "夜·内", summary: "张伟独坐，翻阅李静交给他的信，神色凝重。", present: ["c-zhangwei"], beats: ["b-dilemma"] },
  { id: "s-1-3",  ep: 1, sc: 3, title: "窗前的母亲",       loc: "周家客厅",    time: "夜·内", summary: "周雅静站在窗前，望着外面的街景。桌上有旧相册。", present: ["c-zhouyajing"], beats: ["b-setup"] },
  { id: "s-2-4",  ep: 2, sc: 4, title: "医院档案室",       loc: "仁济医院",    time: "日·内", summary: "张伟瞒着李静去查 1998 年的出生档案。遇到杨姝。", present: ["c-zhangwei", "c-yangshu"], beats: ["b-investigation"] },
  { id: "s-2-5",  ep: 2, sc: 5, title: "晚饭",             loc: "李静家餐厅",  time: "夜·内", summary: "张伟回家，面对李静说谎称去图书馆。", present: ["c-lijing", "c-zhangwei"], beats: ["b-deception"] },
  { id: "s-3-6",  ep: 3, sc: 6, title: "陈妈的电话",       loc: "李静家书房",  time: "日·内", summary: "陈妈打来电话，欲言又止。挂断。", present: ["c-lijing", "c-chenma"], beats: ["b-hint"] },
  { id: "s-4-7",  ep: 4, sc: 7, title: "老相册",           loc: "周家阁楼",    time: "日·内", summary: "李静翻出母亲藏起的相册，看到生母的照片。", present: ["c-lijing"], beats: ["b-discovery"] },
  { id: "s-4-8",  ep: 4, sc: 8, title: "质问",             loc: "周家客厅",    time: "夜·内", summary: "李静向周雅静摊牌。周雅静沉默良久，最终承认。", present: ["c-lijing", "c-zhouyajing"], beats: ["b-revelation"] },
  { id: "s-5-9",  ep: 5, sc: 9, title: "雨夜的争吵",       loc: "李静家卧室",  time: "夜·内", summary: "李静发现张伟早已知情，两人爆发争吵。", present: ["c-lijing", "c-zhangwei"], beats: ["b-climax"] },
  { id: "s-6-10", ep: 6, sc: 10,title: "医院重逢",         loc: "仁济医院",    time: "日·内", summary: "李静主动找到杨姝，得知生母去世的全部经过。", present: ["c-lijing", "c-yangshu"], beats: ["b-resolution"] },
  { id: "s-7-11", ep: 7, sc: 11,title: "扫墓",             loc: "郊外公墓",    time: "清晨·外", summary: "李静独自到母亲墓前。远处，周雅静默默站着。", present: ["c-lijing", "c-zhouyajing"], beats: ["b-reconciliation"] },
  { id: "s-8-12", ep: 8, sc: 12,title: "信",               loc: "静咖啡馆",    time: "日·内", summary: "李静写一封新的信，寄给自己。", present: ["c-lijing"], beats: ["b-coda"] },
];

export const MOCK_BEATS: MockBeat[] = [
  { id: "b-setup",         ep: 1, tension: 2, type: "Setup",        label: "建置",     desc: "日常世界" },
  { id: "b-inciting",      ep: 1, tension: 4, type: "Inciting",     label: "激励事件", desc: "匿名信" },
  { id: "b-dilemma",       ep: 1, tension: 5, type: "Dilemma",      label: "困境",     desc: "张伟的秘密" },
  { id: "b-investigation", ep: 2, tension: 6, type: "Investigation",label: "调查",     desc: "医院档案" },
  { id: "b-deception",     ep: 2, tension: 6, type: "Conflict",     label: "欺瞒",     desc: "谎言成形" },
  { id: "b-hint",          ep: 3, tension: 5, type: "Foreshadow",   label: "暗示",     desc: "陈妈来电" },
  { id: "b-discovery",     ep: 4, tension: 7, type: "Discovery",    label: "发现",     desc: "生母相册" },
  { id: "b-revelation",    ep: 4, tension: 9, type: "Revelation",   label: "揭示",     desc: "母亲承认" },
  { id: "b-climax",        ep: 5, tension: 10,type: "Climax",       label: "高潮",     desc: "夫妻决裂" },
  { id: "b-resolution",    ep: 6, tension: 7, type: "Resolution",   label: "解答",     desc: "生母往事" },
  { id: "b-reconciliation",ep: 7, tension: 4, type: "Reconciliation",label:"和解",     desc: "墓前默契" },
  { id: "b-coda",          ep: 8, tension: 3, type: "Coda",         label: "尾声",     desc: "寄出的信" },
];

export const MOCK_FACTS: MockFact[] = [
  { id: "fact-adoption",     text: "李静是被领养的",   revealBeat: "b-inciting" },
  { id: "fact-husband-knew", text: "张伟早已知情",     revealBeat: "b-investigation" },
  { id: "fact-birth-mother", text: "生母因难产去世",   revealBeat: "b-resolution" },
];

// knowledge[charId][factId] = beatId at which they first know (or null)
export const MOCK_KNOWLEDGE: Record<string, Record<string, string | null>> = {
  "c-lijing":     { "fact-adoption": "b-discovery",    "fact-husband-knew": "b-climax",      "fact-birth-mother": "b-resolution" },
  "c-zhangwei":   { "fact-adoption": "b-inciting",     "fact-husband-knew": "b-setup",       "fact-birth-mother": "b-investigation" },
  "c-zhouyajing": { "fact-adoption": "b-setup",        "fact-husband-knew": "b-revelation",  "fact-birth-mother": "b-setup" },
  "c-chenma":     { "fact-adoption": "b-setup",        "fact-husband-knew": null,            "fact-birth-mother": "b-setup" },
  "c-yangshu":    { "fact-adoption": "b-setup",        "fact-husband-knew": "b-investigation","fact-birth-mother": "b-setup" },
  "c-lijingbirth":{ "fact-adoption": "b-setup",        "fact-husband-knew": null,            "fact-birth-mother": "b-setup" },
};

export const MOCK_ONTOLOGY_DETAIL: MockOntology = {
  entities: [
    { name: "Character", desc: "出场人物。包含主角、配角、隐身叙事角色。",
      fields: [
        { name: "name",    type: "str",       opt: false, note: "人物本名，不含昵称" },
        { name: "role",    type: "literal",   vals: ["protagonist","antagonist","support","ghost"], opt: false },
        { name: "age",     type: "int",       opt: true },
        { name: "aliases", type: "list[str]", opt: true, note: "别名与昵称" },
      ]},
    { name: "Scene", desc: "剧本中的单场戏。按「第X集第Y场」切分。",
      fields: [
        { name: "episode", type: "int", opt: false },
        { name: "scene",   type: "int", opt: false },
        { name: "location",type: "str", opt: true },
        { name: "time",    type: "literal", vals: ["日·内","日·外","夜·内","夜·外","清晨·外","黄昏·外"], opt: true },
      ]},
    { name: "PlotEvent", desc: "推动剧情的具体事件。",
      fields: [
        { name: "summary",   type: "str", opt: false, note: "一句话描述" },
        { name: "importance",type: "int", opt: true },
      ]},
  ],
  edges: [
    { name: "KNOWS",      desc: "角色在某时刻知道某事实", fields: [{ name:"since_beat", type:"str", opt:false }]},
    { name: "PRESENT_IN", desc: "角色出现在场景中",       fields: []},
    { name: "TRIGGERS",   desc: "事件触发另一事件",       fields: []},
  ],
};

export const MOCK_ONTOLOGY_HL: MockOntology = {
  entities: [
    { name: "Beat",  desc: "叙事节拍，三幕结构中的一个转折点。",
      fields: [
        { name: "type",    type: "literal", vals: ["Setup","Inciting","Dilemma","Investigation","Conflict","Discovery","Revelation","Climax","Resolution","Coda"], opt:false },
        { name: "tension", type: "int", opt: false, note: "1–10 张力值" },
      ]},
    { name: "Arc",   desc: "人物弧光 / 叙事线。",
      fields: [{ name:"theme_id", type:"str", opt:true }]},
    { name: "Theme", desc: "主题母题。",
      fields: [{ name:"keyword", type:"str", opt:false }]},
  ],
  edges: [
    { name: "FOLLOWS",    desc: "节拍的时序关系", fields: []},
    { name: "BELONGS_TO", desc: "节拍归属弧光",   fields: []},
  ],
};

export const MOCK_CHAT_SEED: MockChatSeed[] = [
  { q: "张伟何时知道领养的事？",
    a: { fact:"fact-adoption", character:"c-zhangwei", atBeat:"b-inciting",
         summary: "张伟在第 1 集第 1 场「咖啡馆的信」后即知情——李静把信交给了他。",
         trace: ["s-1-1","s-1-2"] }},
  { q: "周雅静什么时候知道张伟早已知情？",
    a: { fact:"fact-husband-knew", character:"c-zhouyajing", atBeat:"b-revelation",
         summary: "周雅静在第 4 集第 8 场与李静摊牌时，才从李静口中得知张伟早有察觉。",
         trace: ["s-4-8"] }},
];

// Role label lookup used by multiple pages.
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

// Convenience lookups so consumers can `findBeat(id)` without repeating `.find`.
export function findBeat(id: string | null | undefined) {
  return MOCK_BEATS.find((b) => b.id === id) || null;
}
export function findCharacter(id: string | null | undefined) {
  return MOCK_CHARACTERS.find((c) => c.id === id) || null;
}
export function findFact(id: string | null | undefined) {
  return MOCK_FACTS.find((f) => f.id === id) || null;
}
export function findScene(id: string | null | undefined) {
  return MOCK_SCENES.find((s) => s.id === id) || null;
}
