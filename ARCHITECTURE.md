# 剧本记忆层 PoC — 技术文档

> 目标：用最少的代码验证「Graphiti + Neo4j + Qwen2.5」能否处理中文剧本场景。
> 本文档覆盖三个阶段全部：Stage 1（基座）、Stage 2（本体 + 中文适配）、
> Stage 3（认知边界查询）。

---

## 1. 系统总览

### 1.1 技术栈
| 层 | 选型 | 理由 |
|---|---|---|
| 知识图谱框架 | **graphiti-core ≥ 0.3** | 时序感知、内置 LLM 抽取 + 向量召回、Pydantic 实体类型 |
| 图数据库 | **Neo4j 5.15-community** + APOC | Graphiti 一等支持；APOC 提供调试用的图遍历过程 |
| 推理 LLM | **Qwen2.5-72B-Instruct** via OpenRouter（OpenAI 兼容） | 中文质量强；走 OpenRouter 统一入口，方便之后横向对比 Claude / GPT / Llama |
| 小模型（代词消解） | **Qwen2.5-7B-Instruct** via OpenRouter | 轻量、便宜；只做局部代词替换不需要 72B |
| 嵌入 | **Qwen3-Embedding-8B** via OpenRouter（4096 dim） | 原生多语言含中文；和 chat 同一把 key、同一个 base URL |
| Reranker / Cross-encoder | `OpenAIRerankerClient(llm_client)` 复用 Qwen-72B | Graphiti 通用客户端必须显式传 reranker，否则会回退到默认 OpenAI 端点 401 |

### 1.2 包结构
```
src/screenplay_memory/
├── __init__.py
├── config.py                 # Settings dataclass，env 加载 + 校验
├── client.py                 # MemoryClient 门面
├── ontology/                 # Stage 2: Pydantic 实体类型
│   ├── __init__.py           # ENTITY_TYPES = {"Character": ..., ...}
│   ├── character.py
│   ├── scene.py
│   └── plot_event.py
├── chinese/                  # Stage 2: 中文适配
│   ├── __init__.py
│   ├── prompts.py            # CHINESE_EXTRACTION_INSTRUCTIONS + SCENE_HEADER_TEMPLATE
│   └── coreference.py        # resolve_coreference(text, known_characters)
└── queries/                  # Stage 3
    ├── __init__.py           # 暴露 query_character_knowledge
    └── cognitive.py
```

---

## 2. MemoryClient 数据流

```
┌─────────────────────┐
│ ingest(content,     │
│        episode,     │
│        scene)       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ _known_character_names()                    │
│   Cypher: MATCH (n:Character) WHERE         │
│           n.group_id=$gid RETURN n.name     │
└──────────┬──────────────────────────────────┘
           │ list[str]
           ▼
┌─────────────────────────────────────────────┐
│ resolve_coreference(content, known)         │
│   ├─ 若 known 为空 → 直接返回原文            │
│   └─ 否则调用 Qwen-7B：将 他/她/它/他们     │
│      替换为具体角色名（不动对白部分）         │
└──────────┬──────────────────────────────────┘
           │ str (resolved)
           ▼
┌─────────────────────────────────────────────┐
│ body = SCENE_HEADER + "\n\n" + resolved     │
│ scene_header = "[本段为第X集第Y场]"          │
│   ↑ 这一步让 LLM 把场次本身识别为 Scene 节点  │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ graphiti.add_episode(                       │
│   name="S01E01",                            │
│   episode_body=body,                        │
│   source_description=                       │
│       CHINESE_EXTRACTION_INSTRUCTIONS,      │
│   source=EpisodeType.text,                  │
│   reference_time=_scene_reference_time(...),│
│   group_id=self.project_id,                 │
│   entity_types={"Character": Character,     │
│                 "Scene":     Scene,         │
│                 "PlotEvent": PlotEvent},    │
│ )                                           │
└──────────┬──────────────────────────────────┘
           │
           ▼ Graphiti 内部：
           │   1. 实体抽取（Qwen-72B 读入 entity_types schema）
           │   2. 实体消歧 / 与已有节点合并
           │   3. 关系抽取 + 时序解析（valid_at/invalid_at）
           │   4. 节点 / 边写入 Neo4j（带 group_id 标签）
           │   5. 文本嵌入写入向量索引
           │
           ▼
┌─────────────────────────────────────────────┐
│ {"status": "success",                       │
│  "entities_created": N,                     │
│  "facts_created":    M,                     │
│  "coreference_applied": bool}               │
└─────────────────────────────────────────────┘
```

---

## 3. 三个关键决策的细节

### 3.1 通过 OpenAIGenericClient 接入 OpenRouter

OpenRouter 提供了 OpenAI 兼容接口（chat + embeddings），路径是
`https://openrouter.ai/api/v1`。Graphiti 有 3 种 LLM 客户端：

| 客户端 | 适用 | 原因 |
|---|---|---|
| `OpenAIClient` | 真正的 OpenAI | 默认 8K token cap；针对官方 endpoint 调优 |
| `AzureOpenAILLMClient` | Azure | 走 Azure 的 deployment 路径 |
| **`OpenAIGenericClient`** | 任何 OpenAI 兼容端点（Ollama、vLLM、OpenRouter、DashScope...） | 16K cap、完整结构化输出支持、容忍非 OpenAI 字段差异 |

代码（`client.py`）：
```python
llm_config = LLMConfig(
    api_key=s.openrouter_api_key,
    model=s.chat_model,              # qwen/qwen-2.5-72b-instruct
    small_model=s.chat_small_model,  # qwen/qwen-2.5-7b-instruct
    base_url=s.openrouter_api_base,  # https://openrouter.ai/api/v1
)
llm_client = OpenAIGenericClient(config=llm_config)
embedder = OpenAIEmbedder(config=OpenAIEmbedderConfig(
    api_key=s.openrouter_api_key,    # 同一把 key
    embedding_model=s.embedding_model,  # qwen/qwen3-embedding-8b
    embedding_dim=s.embedding_dim,      # 4096
    base_url=s.openrouter_api_base,     # 同一个 base URL
))
reranker = OpenAIRerankerClient(client=llm_client, config=llm_config)
```

**换模型**：只改 `.env` 里的 `CHAT_MODEL` / `EMBEDDING_MODEL` / `EMBEDDING_DIM`，
客户端代码一行不动。换 embedding 模型后需要 `docker compose down -v` 清库重建索引。

**坑点**：如果不显式传 `cross_encoder=reranker`，Graphiti 会用默认
`OpenAIRerankerClient`，它回退到官方 OpenAI 端点 → 401。这是 Ollama
官方示例里也强调的一步。

### 3.2 Stage 1 vs Stage 2 — 为什么基座要"裸跑"

Stage 1 的 `MemoryClient.ingest` 完全不传 `entity_types`、不注入指令、不做
预处理。这是用户明确要求的"先证明基座可用"模式：
- 如果基座本身就把"李静"翻译成 "Li Jing"，那加再多本体也救不了；
- 如果基座本身不出问题，再叠 Stage 2 时遇到的失败就一定是适配层的问题，
  调试范围立刻收窄。

**Stage 1 的退出条件**：3 个测试全过 **+ 人肉打开 Neo4j Browser 看节点是中文**。
两个条件都满足才允许进 Stage 2。

### 3.3 Graphiti 没有 `custom_extraction_instructions` 参数

PRD 里假设有这个参数，事实上没有。Graphiti 把 `source_description` 拼到
extraction prompt 里，所以我们把 `CHINESE_EXTRACTION_INSTRUCTIONS` 整段
塞进 `source_description`。这是社区在处理非英语语料时的标准做法。

如果还不够（Qwen 仍然把名字翻译成英文），下一步就是 monkey-patch
`graphiti_core.prompts.*`。**未经用户确认不主动做**——属于 PRD §10
"如果某个 Graphiti 功能不工作：不要绕过它伪造结果"的范畴。

### 3.4 Scene 实体的"幽灵"问题

Graphiti 只抽取**文本里出现过**的实体。`Scene` 的 Pydantic 类只是告诉 LLM
"如果你看到 Scene-like 的东西，按这个 schema 抽"，但不会凭空创建。

解决：在每段 episode_body 前面加一句
`[本段为第X集第Y场]`，让 LLM 把这句话识别为一个 Scene 节点。这种"自然语言
锚点"比直接 Cypher 插入更稳，因为：
- 不需要绕过 Graphiti 的去重 / 合并逻辑
- Scene 可以自然参与后续的关系抽取（"事件发生在第X场"）
- 删数据时仍然走 `group_id` 统一清理

### 3.5 时间轴合成（D4）

Stage 3 的认知查询要回答"角色 A 在第 N 场之前知道什么"。Graphiti 的
`valid_at` 字段由 LLM 从文本里抽取，但剧本里大多数事件没有显式时间词
（"昨天"、"上周"），所以会得到 null。

我们用合成时间轴兜底：
```python
_BASE_EPOCH = datetime(2020, 1, 1, tzinfo=timezone.utc)
def _scene_reference_time(episode, scene):
    return _BASE_EPOCH + timedelta(seconds=episode * 10000 + scene * 100)
```
- `episode * 10000 + scene * 100` 保证场次单调递增
- `reference_time` 传给 `add_episode`，Graphiti 把它作为 episode 的时间锚点
- 查询时只要拿当前场次对应的合成时间和 `valid_at` 比较即可

### 3.6 单项目隔离 vs 全局清空

Graphiti 的 `clear_data(driver)` **删整个数据库**，跑并行测试会互相干扰。
我们用 `group_id` 作为项目 namespace：

```python
async def clear(self):
    async with self._graphiti.driver.session() as sess:
        await sess.run(
            "MATCH (n) WHERE n.group_id = $gid DETACH DELETE n",
            gid=self.project_id,
        )
```

`add_episode(group_id=...)` 给所有创建的节点和边都打上这个标签，`search(group_ids=[...])`
按标签过滤。整个 PoC 默认 `project_id="test_project"`，未来扩多项目只需要
把它做成参数。

---

## 4. 模块责任与契约

### 4.1 `config.py`
- **职责**：唯一读 env 的地方。`Settings.from_env()` 在缺失必需变量时
  立刻抛 `RuntimeError`，避免把配置错误拖到运行时再炸。
- **契约**：`Settings` 是 frozen dataclass，所有字段都是 plain str/int。
- **依赖**：`python-dotenv`（在模块顶部 `load_dotenv()`，所以 import 即生效）。

### 4.2 `client.py` → `MemoryClient`
- **职责**：唯一对外暴露的类。生命周期：`__init__` → `ingest`* → `close`。
- **公共接口**：
  - `__init__(project_id: str)` — 同步构造，初始化 Graphiti / LLM / embedder / reranker
  - `async ingest(content: str, episode: int, scene: int) -> dict`
  - `async clear() -> None` — project-scoped 清空
  - `async close() -> None`
- **内部状态**：
  - `self._graphiti: Graphiti`
  - `self._initialized: bool` — 首次 ingest 时调一次 `build_indices_and_constraints`
- **私有方法**：
  - `_ensure_init()` — 幂等的索引初始化
  - `_known_character_names()` — Cypher 查已存在的 Character 节点

### 4.3 `ontology/`
- 每个模块导出一个 Pydantic 类。**不带任何方法**，只是 schema。
- `__init__.py` 暴露 `ENTITY_TYPES` dict —— 这是 Graphiti `add_episode` 期待的格式。
- **docstring 即 prompt 的一部分**：Graphiti 把 Pydantic 类的 docstring + Field
  description 拼进抽取 prompt，所以这些 docstring 的措辞**直接**影响抽取质量。
  PRD 给的版本是第一轮，预期 Stage 2 跑通过程中要迭代 3-5 次。

### 4.4 `chinese/prompts.py`
- 两个常量：
  - `CHINESE_EXTRACTION_INSTRUCTIONS` — 喂给 `source_description`
  - `SCENE_HEADER_TEMPLATE` — `"[本段为第{episode}集第{scene}场]"`
- 没有任何 Python 逻辑。改这里就是改 prompt。

### 4.5 `chinese/coreference.py`
- **职责**：纯函数 `resolve_coreference(text, known_characters) -> str`
- **关键设计**：
  - `known_characters` 为空时 **直接返回原文**——第一段文本没有上下文，
    LLM 强行猜测反而会引入错误。
  - 直接用 `openai.AsyncOpenAI`，**不**走 Graphiti，避免 Graphiti 的 token cap
    和重试逻辑干扰这一步的 latency。
  - `temperature=0.1` —— 替换任务要确定性。
  - prompt 明确说"不动对白（双引号 / 中文引号内的内容）"，避免破坏台词。

### 4.6 `tests/conftest.py`
- `memory_client` async fixture：每个测试前后各 `clear()` 一次。
- 三个 Cypher debug helper：
  - `get_all_entity_names(client)` — 调试 Stage 1 的英文污染
  - `get_nodes_by_label(client, label)` — Stage 2 测 Character/PlotEvent
  - `get_edges_between(client, src, dst)` — Stage 2 测关系存在性

---

## 5. 测试矩阵

| 阶段 | 文件 | 用例 | 验证什么 |
|---|---|---|---|
| 1 | `test_01_baseline.py::test_baseline_chinese_ingestion` | 简单中文段落能写入 | `entities_created >= 2 AND facts_created >= 1` |
| 1 | `test_01_baseline.py::test_baseline_chinese_search` | 中文 query 能召回 | `search` 返回非空 + 包含 "李静" 或 "张伟" |
| 1 | `test_01_baseline.py::test_baseline_no_english_pollution` | 实体名是中文 | 至少一个节点 `name` 包含 CJK 字符 |
| 2 | `test_02_ontology.py::test_ontology_extracts_characters` | Character 类型抽取 | "李静" "张伟" 都在 `:Character` 节点里 |
| 2 | `test_02_ontology.py::test_ontology_extracts_plot_event` | PlotEvent 抽取 | `:PlotEvent` 节点至少 1 个，包含 "领养" |
| 2 | `test_02_ontology.py::test_ontology_creates_relationships` | 角色间关系 | 李静 ↔ 张伟 之间至少 1 条边 |
| 2 | `test_02_ontology.py::test_ontology_pronoun_resolution` | 代词不进图 | "他" "她" 不出现在 `:Character.name` 里 |
| 3 | `test_03_query.py::test_query_returns_structured_result` | 返回 schema 完整 | 字段 character / at_scene / knows_facts / knows_characters 都在 |
| 3 | `test_03_query.py::test_query_zhang_wei_knows_after_revelation` | 揭露后认知正确 | 张伟@1.2 的 knows_facts 提到 "领养" 或 "身世" |
| 3 | `test_03_query.py::test_query_zhou_yajing_does_not_know` | 时序边界正确 | 周雅静@2.1 的 knows_facts 不含 "寻找/找她" |
| 3 | `test_03_query.py::test_query_includes_known_characters` | 关系反查 | 张伟@1.2 的 knows_characters 含 "李静" |
| 3 | `test_03_query.py::test_query_performance` | 查询延迟 | 单次 < 3s |

**注意**：Stage 2 的代词消解测试有个微妙之处——`scene_01.txt` 是第一场，
`_known_character_names()` 一开始为空，所以 `resolve_coreference` 直接返回
原文。代词不进图要靠 Graphiti 自己的实体抽取 + `CHINESE_EXTRACTION_INSTRUCTIONS`
里"代词不应作为独立实体"这条规则。如果这个测试失败，第一反应应该是去
prompts.py 加强代词排除规则，而不是去 coreference.py。

---

## 6. 已知风险与回退策略

| 风险 | 触发症状 | 回退方案 |
|---|---|---|
| Qwen 把"李静"翻译成"Li Jing" | `test_baseline_no_english_pollution` 失败 | 1) 加强 `CHINESE_EXTRACTION_INSTRUCTIONS`；2) monkey-patch `graphiti_core.prompts`（需用户确认）|
| `entity_types` schema 太复杂导致 Qwen 输出非法 JSON | Stage 2 ingestion 报 ValidationError | 简化 Field description；改用更短的 `event_type` 枚举值 |
| Scene header 句子被 LLM 当成普通描写丢弃 | Neo4j 里看不到 `:Scene` 节点 | 把 header 改得更"实体化"：`第1集第2场，地点：咖啡馆`|
| 别名分裂（"李静"和"静儿"建成两个节点） | `get_nodes_by_label("Character")` 出现重复人 | Stage 2.5：加别名字典预处理（PRD 范围外）|
| Reranker 401 | `search` 报 OpenAI auth error | 确认 `cross_encoder=OpenAIRerankerClient(...)` 已传给 Graphiti 构造器 |
| embedding 维度不匹配 | `add_episode` 报 vector dim mismatch | 换 embedding 模型后务必同步 `EMBEDDING_DIM` 并 `docker compose down -v` 清库重建索引 |

---

## 7. 运行步骤

**详细步骤、验证方法、预期输出** 见 [README.md — 详细运行步骤](README.md#详细运行步骤)（每一步都有验证命令和预期输出）。

本节只保留关键路径的 TL;DR：

```bash
# 0. 前置：获取 https://openrouter.ai 的 API key，充 $1-5 credits

# 1. 启 Neo4j + 安装依赖 + 配置
docker compose up -d
pip install -e ".[dev]"
cp .env.example .env
# 编辑 .env，填入 OPENROUTER_API_KEY

# 2. Stage 1 — 基座测试（不加任何适配）
pytest tests/test_01_baseline.py -v
# 必做：在 http://localhost:7474 跑
#   MATCH (n) WHERE n.group_id='test_project' RETURN n LIMIT 50
# 确认节点 name 是中文。如果是英文 → 停下来，不进 Stage 2

# 3. Stage 2 — 本体 + 中文适配
pytest tests/test_02_ontology.py -v
# 预期：可能要迭代 prompts.py / ontology docstring 几次才能全过

# 4. Stage 3 — 认知边界查询
pytest tests/test_03_query.py -v
```

**换模型**（chat 或 embedding）只改 `.env`，代码不动;换 embedding 模型要
`docker compose down -v` 清库重建向量索引。详见 [README — 切换模型](README.md#切换模型)。

---

## 8. Stage 3 — 认知边界查询

### 8.1 公开接口
`MemoryClient.query_cognitive` 同时支持两种调用形式，
桥接 PRD §6.1 与 §7.3 的不一致：
```python
# 形式 A（§6.1 单参）：episode 默认 1
client.query_cognitive("张伟", at_scene=2)

# 形式 B（§7.3 双参，规范形式）
client.query_cognitive("张伟", at_scene_episode=1, at_scene_number=2)
```
内部统一转成 `(at_scene_episode, at_scene_number)` 后调用
`queries.cognitive.query_character_knowledge`。

### 8.2 查询管线

```
client.query_cognitive(character, episode, scene)
              │
              ▼
   cutoff = _scene_reference_time(episode, scene + 1)
              │   ↑ 注意 scene+1：包含目标场次本身已经发生的事件
              ▼
   graphiti.search(
       query=f"{character} 知道的事情和遇到的人",
       group_ids=[project_id],
       num_results=20,
   )
              │   list[EntityEdge]
              ▼
   for each edge:
     ├─ 过滤 1：valid_at < cutoff           （事件已经发生）
     ├─ 过滤 2：invalid_at is None
     │           or invalid_at > cutoff       （事件未失效）
     ├─ 过滤 3：character in edge.fact         （确实和该角色相关）
     ├─ 收集 fact 到 knows_facts
     ├─ 通过 source_node_uuid / target_node_uuid 反查另一端节点
     │   ├─ 如果另一端是 :Character → 加入 knows_characters
     │   └─ 否则忽略
     └─ 如果 edge.name 含 "目睹"/"witness"/"参与" → 加入 witnessed_events
              │
              ▼
   {
     "character":        "...",
     "at_scene":         {"episode": ..., "scene": ...},
     "knows_facts":      [...],
     "knows_characters": [...],
     "witnessed_events": [...],
     "query_metadata":   {"cutoff": ..., "edges_scanned": N, "edges_kept": M},
   }
```

### 8.3 设计取舍

- **依赖 Graphiti 的 `search` 而不是 raw Cypher**：MVP 阶段先验证 Graphiti
  自带的混合检索（向量 + BM25 + reranker）能不能撑住业务语义查询。如果
  Stage 3 测试发现召回不足，再退到自定义 Cypher 查 `(:Character)-[r:KNOWS|WITNESSED]->()`
  按 `r.valid_at` 过滤——但**先报告，不主动加**（PRD §10）。
- **`valid_at` null 的边保留**：Graphiti 的 `valid_at` 来自 LLM 解析，剧本
  里大量事件没有显式时间词，会得到 null。如果直接丢掉这些边，几乎所有
  事实都会消失。所以策略是：null = "无法确定，保守保留"。合成的
  `reference_time`（Stage 1 §3.5）已经在 episode 层面给了顺序，足够支撑
  PoC 的粒度。
- **`character in edge.fact` 用子串匹配而不是节点 UUID 匹配**：实现简单，
  对中文也直接生效（不需要 word boundary）。代价是同名角色可能误中——
  PoC 范围内不处理，留给后续别名 / disambiguation 工作。
- **`knows_characters` 通过反查 UUID 而不是再 search**：节省一次 LLM 调用。
  Cypher 一把查双端节点，Python 侧排除自己。

### 8.4 可能的失败模式与诊断

| 失败 | 最可能原因 | 第一步排查 |
|---|---|---|
| `test_query_zhang_wei_knows_after_revelation` 失败 | Stage 2 没把"领养"抽成 PlotEvent 或没建张伟 KNOWS 边 | 去 Neo4j Browser 看 `MATCH (a:Character {name:'张伟'})-[r]->(b) RETURN a,r,b`；如果空，回到 Stage 2 调 docstring |
| `test_query_zhou_yajing_does_not_know` 失败 | cutoff 算错 / `valid_at` 没起作用 | 打印 `result["query_metadata"]["cutoff"]`，对照 `_scene_reference_time(2, 2)`；查 edge 的实际 `valid_at` |
| `test_query_includes_known_characters` 失败 | 反查 UUID 路径在 Graphiti 版本里字段不同 | 打印 `edge.source_node_uuid` / `target_node_uuid`，确认非 None；检查 Cypher 反查的 `labels(n)` |
| `test_query_performance` 失败 | reranker 走了远端 API + 网络抖动 | 减小 `num_results`；本地缓存 embedder；或暂时 skip 这条用例先调正确性 |

---

## 9. 设计原则回顾

引用 PRD §"给 Claude Code 的说明"：
> 1. 能跑通比代码优雅重要
> 2. 测试用例就是验收标准
> 3. 失败的测试要提供清晰的错误信息便于调试
> 4. 文档要让一个新人能在 30 分钟内跑起来

对应实现：
- **#1**：Stage 1 故意裸跑，`MemoryClient` 用 dataclass 而不是 Pydantic Settings；
  没有抽象层、没有依赖注入、没有 plugin 系统。
- **#2**：所有 PRD §7 的测试用例**逐字**保留——adapter（D1 的 `at_scene` 兼容）
  在 client 层处理，不动测试。
- **#3**：每个 assert 都带上下文（`f"missing 李静, got: {character_names}"`）；
  Cypher debug helper 是测试的一等公民。
- **#4**：本文档 + README + .env.example，三件套覆盖装配、配置、运行。

---

## 10. 未来扩展

按用户的"三层适配"框架，本 PoC 覆盖三层的核心路径：

| Layer | PoC 做了 | PoC 没做 |
|---|---|---|
| 1. 本体 | Character / Scene / PlotEvent | Foreshadowing / Setting；Edge Type Map |
| 2. 中文 | Coreference 预处理；中文抽取指令；Scene header 锚点 | 别名字典；alias normalization |
| 3. 查询 | `query_cognitive` 基于 Graphiti hybrid search + valid_at 过滤 | 自定义 Cypher 路径；时间线查询；伏笔回收追踪 |

PoC 全部通过 → 下一步推荐：
1. 加 Foreshadowing + Setting + Edge Type Map
2. 引入别名字典（运行时学习 + 用户预设）
3. 真正实现 `query_cognitive` 并跑 ground-truth 评测
4. 多项目 / 多剧本支持（`project_id` 已经预留）
