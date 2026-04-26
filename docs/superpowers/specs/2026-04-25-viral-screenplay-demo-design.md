# Viral Short-Drama Demo · Design

**Date**: 2026-04-25
**Status**: Approved (brainstorm)
**Driver**: 取代当前 demo (《李静张伟》3 场), 用真实爆款短剧《厉总，你找错夫人了》(或同套路替代品) ingest 出更复杂的图谱, 演示 (a) 详细层多类型实体/关系, (b) 节拍层复刻爆款配方, (c) 前端按类型配色 + 节点/边 inspector 结构化 metadata.

## 1 · Goals & Non-goals

### 1.1 Goals
- **数据复杂度**: 详细层 ≥ 100 节点, 8+ 实体类型, 3 边类型同时出现.
- **HL 节拍层可读性**: 一眼看到爆款配方 (节拍密度 / 套路标签 / 张力曲线).
- **图谱可视化**: 14 类节点各自颜色, 3 类边各自线型, 单色印刷可辨.
- **Inspector 完整性**: 点击节点或边 → 抽屉里显示 100% 提取出的 metadata, 不再是原始 JSON.
- **预算硬约束**: 完整 ingest (含 1 次重试) ≤ $5 OpenRouter 调用费.

### 1.2 Non-goals
- 不向后兼容旧 demo. 旧 ontology 文件 / 旧 seed_data / 旧 demo.py 全部替换.
- 不做实时 ingest UI 优化 (现有 SSE 进度条够用).
- 不重写 cognitive query (Stage 3 的 `query_character_knowledge` 沿用; `witness_scope` 字段保留语义).
- 不实现 ontology preset 选择器 UI (新 ontology 直接成为 default).

## 2 · 详细层 Ontology

替换 `src/screenplay_memory/ontology/`. 删除旧 4 个文件, 新增 7 个, 改写 1 个 (edges.py).

### 2.1 实体 (10 类, 7 新 + 3 保留改造)

```python
# character.py — REPLACED (字段精简)
class Character(BaseModel):
    """剧本中的有名字角色 (主角/配角/反派). 路人不抽."""
    role_type: Literal["protagonist","antagonist","supporting","antagonist_redeemed"] = "supporting"
    gender: Literal["male","female","unknown"] = "unknown"
    status_tags: list[str] = []     # ['有钱','失忆','重生','双面身份','病娇','傲娇']

# identity.py — NEW
class Identity(BaseModel):
    """角色的某一个身份 / 马甲 / 真实身份. 一个 Character 可有多 Identity, 经 IS_PERSONA_OF 边相连."""
    persona_label: str               # "厉氏集团会计" / "苏家二小姐"
    is_real: bool = False            # True=真身; False=马甲
    associated_skills: list[str] = []

# family.py — NEW
class Family(BaseModel):
    """剧中明确出现的家族单元 (有名字: 厉家/苏家). 临时小队不抽."""
    family_name: str
    family_alignment: Literal["protagonist","antagonist","neutral"] = "neutral"
    influence_level: int = 3         # 1-10

# organization.py — NEW
class Organization(BaseModel):
    """组织 / 公司 / 机构. 与 Family 区分: Family=血缘; Organization=契约/雇佣."""
    org_name: str
    org_type: Literal["company","hospital","school","clan_business","government","other"] = "company"

# item.py — NEW
class Item(BaseModel):
    """剧情承载物品 (信物/证据/合同/传家宝). 日常物品不抽."""
    item_name: str
    item_role: Literal["token","evidence","contract","gift","heirloom","weapon","other"] = "other"
    significance: str = ""           # 一句话剧情意义

# location.py — NEW
class Location(BaseModel):
    """至少在 2 个不同 Scene 中出现的物理场所. 一次性场所不抽."""
    loc_name: str
    loc_type: Literal["office","home","hospital","restaurant","outdoor","school","other"] = "other"

# misunderstanding.py — NEW (误会流核心)
class Misunderstanding(BaseModel):
    """某角色持有的与事实不符的认知. 仅当原文出现 '误以为/错以为/以为/认为是' 等明确语标时抽."""
    false_belief: str                # "苏念是拜金女"
    severity: int = 3                # 1-5
    is_resolved: bool = False

# secret.py — NEW
class Secret(BaseModel):
    """只对部分角色公开的关键信息. 与 Misunderstanding 互补 (Secret=隐藏真相; Mis=错误认知)."""
    secret_content: str
    secret_type: Literal["identity","past_event","relationship","intention","asset","other"] = "other"

# scene.py — KEPT (字段精简)
class Scene(BaseModel):
    episode: int
    scene_number: int
    location_hint: str = ""
    time_of_day: Literal["morning","afternoon","evening","night","unknown"] = "unknown"

# plot_event.py — KEPT (扩 event_type)
class PlotEvent(BaseModel):
    event_summary: str
    event_type: Literal["confrontation","revelation","decision","transition","emotional_peak","other"] = "other"
```

**Graphiti 受保护字段**: 不能用 `name / summary / labels / uuid / group_id / attributes / created_at / name_embedding`. 因此用 `family_name / org_name / loc_name / item_name / persona_label / false_belief / secret_content / event_summary` 作为 "name" 等价物.

### 2.2 边类 (3 类)

```python
# edges.py — REWRITTEN
class ScreenplayRelation(BaseModel):
    """通用边: KNOWS / OCCURS_IN / MEMBER_OF / WORKS_FOR / IS_PERSONA_OF /
    POSSESSES / IS_TOKEN_OF / LOCATED_AT / RELATED_TO / 等等. 边名由 LLM 决定."""
    witness_scope: list[str] = []    # 知晓此关系的 Character 名字 (规则同前)
    relation_strength: int = 3       # 1-5; 表面关系=1, 核心羁绊/冲突=5

class BelievesAbout(BaseModel):
    """Character → Misunderstanding 的边."""
    since_episode: int = 0           # 从第几集开始持有
    until_episode: int = 0           # 第几集被揭穿 (0=尚未)
    confidence: Literal["certain","suspicious","doubt"] = "certain"

class KnowsSecret(BaseModel):
    """Character → Secret 的边."""
    since_episode: int = 0
    knowledge_source: Literal["witnessed","told_by","deduced","born_with","unknown"] = "unknown"
```

`witness_scope` 在 `ScreenplayRelation` 上保留, 是 cognitive query 系统的 ABI; 边语义不变, 只是字段补强.

### 2.3 ENTITY_TYPES / EDGE_TYPES 注册

```python
# ontology/__init__.py
ENTITY_TYPES = {
    "Character": Character, "Identity": Identity, "Family": Family,
    "Organization": Organization, "Item": Item, "Location": Location,
    "Misunderstanding": Misunderstanding, "Secret": Secret,
    "Scene": Scene, "PlotEvent": PlotEvent,
}
EDGE_TYPES = {
    "ScreenplayRelation": ScreenplayRelation,
    "BelievesAbout": BelievesAbout,
    "KnowsSecret": KnowsSecret,
}
```

## 3 · 节拍层 Ontology

### 3.1 实体 (4 类, 1 新 + 1 扩展)

```python
# beat.py — EXTENDED (10 BeatType)
BeatType = Literal[
    "Hook", "IncitingIncident", "RisingAction", "Midpoint", "Climax", "Resolution",
    "CliffHanger",      # 集末悬念
    "FacePlay",         # 打脸时刻
    "Twist",            # 反转 (含误会被揭穿)
    "PayoffMoment",     # 爽点高潮
]

class Beat(BaseModel):
    beat_type: BeatType
    beat_summary: str = ""
    scene_range_start: str = ""
    scene_range_end: str = ""
    tension_level: int = 3           # 1-10
    involved_characters: list[str] = []
    audience_emotion: Literal["thrill","satisfaction","shock","anger","sweetness","tension","tear","other"] = "other"

# trope.py — NEW
class Trope(BaseModel):
    """爆款套路标签."""
    trope_name: str                  # "霸总人设" / "误会流" / "双向隐瞒" / "契约结婚" / 等
    trope_category: Literal["character","plot","relationship","structure","other"] = "other"
    popularity_score: int = 5        # 1-10 在 2024-2026 短剧市场流行度

# arc.py / theme.py — KEPT 不变.
```

### 3.2 HL_ENTITY_TYPES / HL_EDGE_TYPES

```python
HL_ENTITY_TYPES = {"Beat": Beat, "Arc": Arc, "Theme": Theme, "Trope": Trope}
HL_EDGE_TYPES   = {"BeatRelation": BeatRelation}     # 类不变
```

`BeatRelation.relation_type` 已有 `EMBODIES` 选项, **直接复用承载 Trope→Beat / Trope→Arc / Trope→Theme 边** ("某节拍 EMBODIES 某套路"). 如运行中发现语义混淆, 再考虑新加 `EXEMPLIFIES` 子类型 (此 spec 范围内不加).

## 4 · 源剧本采集

### 4.1 选源
- 主候选: 《厉总，你找错夫人了》 / 《闪婚后, 亿万总裁马甲藏不住了》 (任一在番茄小说有完整公开章节的同套路作品).
- 锁定后, 把番茄章节 URL 列入 `tests/seed_data/source_urls.txt`.

### 4.2 抓取脚本 (`scripts/fetch_novel.py`, NEW)
- 输入: `source_urls.txt` (10-15 URL).
- 用 `httpx` GET 章节页 + 正文选择器解析 (番茄章节有标准 HTML 结构).
- 输出: `tests/seed_data/raw/chapter_{N}.txt` (纯文本).
- 不调用 LLM, 0 成本.

### 4.3 改写脚本 (`scripts/adapt_to_scenes.py`, NEW)
- 输入: `tests/seed_data/raw/chapter_{N}.txt`.
- 调 LLM (Qwen2.5-72b 一次, ~$0.5 总) 把每章拆成 4-6 场, 输出剧本格式:
  ```
  【第N集第M场】场景: 厉总办公室 / 时间: 上午
  [厉北辰坐在办公桌前, 翻看苏念的资料.]
  厉北辰: "查清楚了, 这个女人就是冲着我的钱来的."
  ...
  ```
- prompt 里 **明确告知 ontology 类型 + 例子**, 引导 LLM 在改写时刻意保留(不消除) Identity/Misunderstanding/Item 等线索.
- 输出: `tests/seed_data/scenes/ep{N}_sc{M}.txt`, 共 ~60 场.
- 改写后 **手动 review 一遍** (一次性, 不在 CI). 确保前 3 集每个新实体类型至少出现 1 次.

### 4.4 灌库
- 新 project_id: `bazong_demo`.
- `MemoryClient(project_id="bazong_demo").ingest(text)` 逐场调用; HL 层 `ingest_hl(scenes)` 全剧一次.
- 灌库后跑 `scripts/build_scene_index.py` (见 §5.4).

### 4.5 预算
| 阶段 | 估算 |
|---|---|
| 章节抓取 | $0 |
| 章节→场次改写 (一次性) | $0.5 |
| 详细层 ingest 60 场 | $2.5 |
| 节拍层 ingest 1 次 | $0.5 |
| 重试预算 | $1.5 |
| **总计** | **~$5** |

## 5 · 后端 (Python) 改动

### 5.1 Prompts
- `chinese/prompts.py` 完全重写: 新 ontology 的 entity 抽取指令, 含每个新类型的 1-2 个正例 + 1 个反例.
- `chinese/prompts_hl.py` 扩 BeatType 描述, 新增 Trope 抽取指令.

### 5.2 不变的部分
- `client.py::MemoryClient` 公开接口完全不变 (`ingest / ingest_hl / clear / query_cognitive` 全保留).
- `queries/cognitive.py` 无变化.
- `annotations.py` / `annotations_hl.py` 无变化.
- `ontology_customization.py::spec_to_pydantic` whitelist 不变 (新 ontology 用的全是已支持类型).

### 5.3 旧测试处理
全部重写:
- `test_01_baseline.py` → 用新 ontology 的最小 ingest 测试.
- `test_02_ontology.py` → 验证 7 新实体类型至少各 1 个被抽取.
- `test_03_query.py` → 沿用 `query_character_knowledge`, 数据换成新 demo.
- `test_04_hl_ingest.py` → 测试 BeatType=10 / Trope 抽取.
- `test_05_customization.py` / `test_05_edits.py` → 不变 (不依赖具体 ontology).
- `test_06_api.py` → 更新 mock 数据.

旧 `seed_data/scene_01.txt`-`scene_03.txt` 删除.

### 5.4 Scene Inverse Index (NEW)
**目的**: 节点 inspector 显示 "出现于 12 场"; 边 inspector 显示 "S01E01 / S04E03 / S07E02 + 原文片段".

**实现** (`src/screenplay_memory/queries/scene_index.py`, NEW):

每个 Graphiti `EntityNode` / `EntityEdge` 自带 `episodes: list[str]` 属性 (引用源 Episodic UUID). 我们一次 `add_episode` 对应一场, 因此 `episodes` 直接就是 "在哪些 Episodic 里被抽到", 但还要把 Episodic UUID 翻译回 Scene UUID. 索引脚本两步:

1. **建立 Episodic → Scene 映射表** (一场调一次 `add_episode`, Episodic 的 `reference_time` 是 `_BASE_EPOCH + episode*10000s + scene*100s`, 反推 episode/scene number):
   ```cypher
   MATCH (e:Episodic) WHERE e.group_id=$gid
   MATCH (s:Scene) WHERE s.group_id=$gid
     AND s.episode = $ep AND s.scene_number = $sc  // by reference_time decode
   MERGE (e)-[:OF_SCENE]->(s)
   ```

2. **写 scene_appearances 到节点 / 边**:
   ```cypher
   // 节点
   MATCH (n) WHERE n.group_id=$gid AND NOT 'Scene' IN labels(n) AND NOT 'Episodic' IN labels(n)
   OPTIONAL MATCH (e:Episodic)-[:OF_SCENE]->(s:Scene) WHERE e.uuid IN n.episodes
   WITH n, collect(DISTINCT s.uuid) AS sids
   SET n.scene_appearances = sids

   // 边 (两端都不是 Episodic)
   MATCH (a)-[r]->(b) WHERE a.group_id=$gid AND r.episodes IS NOT NULL
   OPTIONAL MATCH (e:Episodic)-[:OF_SCENE]->(s:Scene) WHERE e.uuid IN r.episodes
   WITH r, collect(DISTINCT s.uuid) AS sids
   SET r.scene_appearances = sids
   ```

3. **写边的原文 quote** (取 source Episodic 的原文中提到 source/target 名字的 ±50 字片段, 限 100 字; Python 后处理, 不在 Cypher 里):
   ```python
   for edge in edges_with_episodes:
       for episodic_uuid in edge.episodes[:3]:  # 最多 3 段引用
           text = fetch_episodic_text(episodic_uuid)
           snippet = extract_around_names(text, edge.source_name, edge.target_name)
           edge.quotes.append({"scene_uuid": ..., "snippet": snippet})
       # 写回 r.quotes (序列化为 JSON 字符串属性)
   ```

派生属性都落到节点 / 边自身, GraphDTO 直接吐, 前端零额外 query.

**API**: `api/main.py::graph_endpoint` 已经把节点 / 边的 properties 透传; 这次只要确保 `properties.scene_appearances` 和 `properties.quotes` 在 DTO 里露出来即可. 不新增端点.

## 6 · 前端 (React) 改动

### 6.1 颜色 token (`web/src/tokens.css`)
新增 8 个 CSS 变量, 保留原有 6 个:
```css
--ident-500:   #e88290;
--family-500:  #9b6f3a;
--org-500:     #3a5f9b;
--loc-500:     #3a8b4f;
--item-500:    #d4a017;
--mis-500:     #7e3a9b;
--secret-500:  #3a1e5e;
--trope-500:   #e6c870;
/* 保留: --char-500 --scene-500 --event-500 --beat-500 --arc-500 --theme-500 */
```
深色模式 (`@media (prefers-color-scheme: dark)`) 各色亮度 +15%.

### 6.2 ForceGraphPanel.tsx
- `KIND_COLOR_VARS` map 扩展 14 项.
- `nodeSize` 调整: Identity=10, Family=12, Org=12, Loc=10, Item=10, Mis=11, Secret=11, Trope=13.
- **边样式按类型**: 通过 edge.type 字段在 render 时区分:
  - `ScreenplayRelation` → 实线, 宽度 = `relation_strength * 0.3 + 0.5`.
  - `BelievesAbout` → 虚线 (dash 6,3), 紫色, `is_resolved=true` 时透明度 40%.
  - `KnowsSecret` → 粗实线 (宽 2.5), 深紫.
- **边点击**: 现 panel 只支持节点点击; 加 hit-test for edges (距离 < 6px), 触发 `onSelectEdge(edge)`.
- **边 hover emoji**: 仅 hover 时, 在边中点画 `knowledge_source` 对应 emoji (👁️/🗣️/💭).

### 6.3 NodeInspector.tsx (REWRITE)
原 dump JSON, 改成结构化:
- Header: 节点名 + 类型徽章 + status_tags chips.
- 基础属性区: 表格化 (key/value 双列).
- 关联子实体区: 例如 Character 节点列出 IS_PERSONA_OF 的 Identity (从 graph 一跳计算).
- 1-hop 邻居 chips: 按邻居类型颜色染色, 点击切换选中节点.
- 出现于场次区: 读 `node.properties.scene_appearances` (UUID 列表) → 显示 SnnEmm tag + 折叠.
- 编辑按钮区: 重命名 / 删除 (现有 API 不变).

### 6.4 EdgeInspector.tsx (NEW)
对称结构:
- Header: source 节点名 → target 节点名, 关系名, 边类型徽章.
- 边属性区: since_episode / until_episode / confidence / witness_scope / relation_strength.
- 关联节点属性区: BelievesAbout / KnowsSecret 时同时显示目标 Misunderstanding/Secret 的属性.
- 出现于场次 + 原文片段区: 读 `edge.properties.scene_uuids` + `edge.properties.quote`.
- 编辑按钮: 改边名 / 删除.

### 6.5 Graph 页面 Tab (`web/src/pages/Graph.tsx`)
顶栏 3 Tab:
- **Tab 1 详细图谱**: graph from `GET /projects/{pid}/graph` (group_id=`{pid}`).
- **Tab 2 节拍图谱**: graph from `GET /projects/{pid}/graph?layer=hl` (group_id=`{pid}__hl`).
- **Tab 3 桥接视图**: graph 包含 Beat 节点 + COVERS 的 Scene + 详细层中关键节点; 走新端点 `GET /projects/{pid}/graph?layer=bridge`.
- Tab 切换时清空 selection, 不重置布局位置 (各 layer 独立 force-sim 状态).

### 6.6 类型定义 (`web/src/types.ts`)
`EdgeDTO` 增 `properties: Record<string, unknown>` (与 NodeDTO 对称, 用于承载边 metadata).

### 6.7 Mock 数据 (`web/src/mockdata.ts`)
KIND_ZH 加 8 个新中文标签. ROLE_ZH 不变.

## 7 · API 改动 (`api/`)

- `GET /projects/{pid}/graph?layer={detail|hl|bridge}`: 新参数, default=detail.
- `GraphDTO.edges[].properties`: 边 metadata 已经存在? 若没: 加上, 让前端能读 since_episode 等.
- 其余端点不变.

## 8 · 测试

### 8.1 Python
- 5 个旧测试全部重写 (见 §5.3).
- 新增 `test_07_scene_index.py`: 验证 ingest 后 inverse index 写入正确.
- 全部测试 `pytest -v` 通过, `ruff check` 干净.

### 8.2 前端
- 现项目无前端测试; 此次也不加 (维持 scope).
- 手动 QA: 14 类节点全部出现且颜色正确; 3 类边样式区分; Inspector 全字段显示; Tab 切换正常.

### 8.3 验收脚本
`scripts/demo.py` 重写, 演示 3 个剧情:
1. **认知边界**: 厉北辰 vs 苏念在第 N 集的 knows_facts 对比.
2. **节拍密度**: HL 层节拍数量 / 类型分布 / 张力曲线.
3. **套路标签**: Trope 列表 + 每个 Trope 关联到的节拍.

## 9 · 实施顺序

1. **Phase 1 — Ontology + Prompts**: 删旧, 写新 7 实体, 改 edges.py, 更新 `__init__.py`. 写 prompts.py / prompts_hl.py. (~半天)
2. **Phase 2 — 源剧本**: 跑 fetch + adapt, 手动 review 60 场. (~半天)
3. **Phase 3 — 灌库 + 索引**: ingest detail + HL, 跑 scene_index.py, Neo4j Browser 验证. (~$3 + 半天)
4. **Phase 4 — 测试**: 重写 5 个测试, 加 test_07. (~半天)
5. **Phase 5 — 前端**: tokens.css → ForceGraphPanel → NodeInspector → EdgeInspector → Graph.tsx 顺序. (~1 天)
6. **Phase 6 — Demo**: 录制 3 个剧情. (~半天)

总计 ~3.5 天. 一次性预算 ~$5.

## 10 · Open Questions

- 番茄小说的具体源 URL 在 Phase 2 启动前选定 (URL 选定后再开 PR).
- Trope 的 popularity_score 由 LLM 自己估还是查表? **决定**: LLM 估, 后续可加查表.
- bridge 视图的具体 force-sim layout (两层节点位置如何拉开)? **决定**: Phase 5 实现时再决定, 不在此 spec 范围.

## 11 · 文件 Inventory

**Replace / rewrite**:
- `src/screenplay_memory/ontology/{__init__,character,scene,plot_event,edges}.py`
- `src/screenplay_memory/ontology_hl/{__init__,beat}.py`
- `src/screenplay_memory/chinese/{prompts,prompts_hl}.py`
- `tests/test_0{1,2,3,4,6}_*.py`
- `scripts/demo.py`
- `web/src/components/{ForceGraphPanel,NodeInspector}.tsx`
- `web/src/pages/Graph.tsx`
- `web/src/{types,mockdata,tokens.css}`

**New**:
- `src/screenplay_memory/ontology/{identity,family,organization,item,location,misunderstanding,secret}.py`
- `src/screenplay_memory/ontology_hl/trope.py`
- `src/screenplay_memory/queries/scene_index.py`
- `scripts/{fetch_novel,adapt_to_scenes,build_scene_index}.py`
- `tests/seed_data/{source_urls.txt, raw/*, scenes/*}`
- `tests/test_07_scene_index.py`
- `web/src/components/EdgeInspector.tsx`

## 12 · 已知风险

- **抽取漂移**: 10 实体类型对 Qwen2.5-72b 是上限附近. 若 Phase 3 灌库后发现某类型抽取率 < 20%, 优先打磨该类型的 prompt 例子, 而非缩减 ontology.
- **`spec_to_pydantic` 兼容**: 新 ontology 全部用 `str / int / float / bool / list[str] / Literal[...]`, 与 `ontology_customization.py` 的 whitelist 兼容; runtime customization 不受影响.
- **桥接视图 group_id**: 现有 `annotations_hl.py::attach_beats_to_scenes` 已写 `group_id='bridge'`, Tab 3 直接读这个 group_id 即可.
- **预算超支**: 如灌库 Phase 3 发现成本飙升, fallback 是把 ingest 切到 Qwen2.5-7b (extraction 质量降, 但成本砍 70%). 不在 spec 默认路径.

**Delete**:
- `tests/seed_data/scene_0{1,2,3}.txt`
