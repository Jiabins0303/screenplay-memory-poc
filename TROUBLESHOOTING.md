# TROUBLESHOOTING

实施 PoC 过程中可能遇到的坑、症状与解决方案。
按"症状 → 原因 → 修法"组织，方便从错误信息反查。

---

## 安装 / 环境

### `ImportError: cannot import name 'OpenAIGenericClient'`
**原因**：graphiti-core 版本太旧。
**修法**：`pip install -U "graphiti-core>=0.3.0"`。

### `ImportError: cannot import name 'OpenAIRerankerClient'`
**原因**：同上，或者从错误的子模块 import。
**修法**：路径是 `from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient`。

### `RuntimeError: Missing required env vars: ['OPENROUTER_API_KEY']`
**原因**：`.env` 没拷贝或没填。
**修法**：`cp .env.example .env` 后填 OpenRouter key（在 https://openrouter.ai 账户页生成，
形如 `sk-or-v1-...`）。`Settings.from_env()` 故意做 fail-fast，不要在 `config.py` 给
`OPENROUTER_API_KEY` 默认值——把配置错误留到运行时再炸更难调。

---

## OpenRouter 相关

### `401 Unauthorized` / `Invalid API key`
**原因**：`.env` 里的 `OPENROUTER_API_KEY` 错了（过期、删了、复制时多/少字符）。
**修法**：
1. 打开 https://openrouter.ai/settings/keys 确认 key 还在且未禁用
2. 如果在，重新复制一次粘贴到 `.env`（注意不要带两头空格）
3. 用 curl 独立验证：
   ```bash
   curl https://openrouter.ai/api/v1/models \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" | head -c 200
   ```
   返回 JSON 列表 → key 有效；返回 `{"error":...}` → 无效

### `402 Payment Required` / `Insufficient credits`
**原因**：OpenRouter 余额不足。
**修法**：https://openrouter.ai/settings/credits 充值。PoC 全量跑完三阶段预计
消耗 < $0.50（Qwen 系列便宜）。换成 Claude Sonnet 等大模型会显著上升。

### `404 Model not found` / `not a valid model ID`
**原因**：`CHAT_MODEL` / `EMBEDDING_MODEL` 写错。OpenRouter 的格式是
`{provider}/{model-name}`，例如 `qwen/qwen-2.5-72b-instruct`——注意有连字符。
**修法**：
1. 打开 https://openrouter.ai/models?q=qwen 搜索想用的模型
2. 看页面 URL `openrouter.ai/<provider>/<model-id>`，model ID 就在这里
3. `.env` 里的值照抄

### `429 Rate limit exceeded`
**原因**：OpenRouter 对免费账户和新账户有较低的 rpm 限制；有些 provider 也会单独限流。
**修法**：
1. 等 1 分钟重试（临时）
2. 充值后限制会放宽
3. 跑测试时串行不要并发：`pytest -x`（fail-fast 模式不会并发）

### OpenRouter 延迟明显高于 DashScope（中国大陆）
**症状**：单次 `ingest` 要 30s+，Stage 3 的 `test_query_performance` 经常超 3s。
**原因**：OpenRouter 服务器在美国，跨洋延迟 + OpenRouter 自己也要路由一跳。
**可选修法**：
- 把 `test_query_performance` 的阈值从 3s 放宽到 5s（改测试是最后手段，先报告）
- 在 `.env` 指定 provider 走距离近的 provider（例如 `DeepInfra` 在新加坡有节点）：
  暂不在本 PoC 支持，未来可通过 `extra_body={"provider": {"order": [...]}}` 实现
- 回退到 DashScope：见 git history（`git log --all --oneline` 找切换前的 commit）

---

## Neo4j 连接

### `ServiceUnavailable: Failed to establish connection ... bolt://localhost:7687`
**原因**：容器没起来、还在初始化、或端口被占。
**修法**：
```bash
docker compose ps                # 看状态
docker logs screenplay-neo4j     # 看启动日志
lsof -i :7687                    # 看端口占用
```
首次启动 Neo4j 大概要 10-15 秒，可以等一下再试。

### `Neo.ClientError.Security.Unauthorized`
**原因**：密码不匹配。`docker-compose.yml` 写死 `neo4j/testpassword`，
`.env.example` 也是这个，但如果你之前用过 Neo4j 容器，data volume
里残留了别的密码。
**修法**：`docker compose down -v && docker compose up -d`（注意 `-v` 删卷，
会清掉所有数据）。

---

## Graphiti × Qwen

### Stage 1 失败：`test_baseline_no_english_pollution`
**症状**：节点 `name` 是 `Li Jing`、`Zhang Wei` 之类英文。
**原因**：Graphiti 默认 prompt 是英文，Qwen2.5 在没有强约束时会顺手翻译。
**第一轮修法**：Stage 1 没注入指令，所以这是预期可能发生的失败。**先报告，
不要往 Stage 2 推进**（PRD §10）。
**第二轮**：进 Stage 2，`source_description=CHINESE_EXTRACTION_INSTRUCTIONS`
应该能解决。
**第三轮（兜底）**：monkey-patch `graphiti_core.prompts.extract_nodes`
等 prompt 模板，强行替换为中文版本。需要用户确认才做——属于"绕过 Graphiti
功能"的范畴。

### `OpenAIError: Connection error` 或 401
**原因**：reranker 没显式传，Graphiti 默认初始化的 `OpenAIRerankerClient`
回退到了官方 OpenAI 端点。
**修法**：确认 `MemoryClient.__init__` 里有：
```python
reranker = OpenAIRerankerClient(client=llm_client, config=llm_config)
self._graphiti = Graphiti(..., cross_encoder=reranker)
```
缺一不可。这是 Graphiti 的 Ollama 示例里也踩过的坑。

### `ValidationError` 在 add_episode 阶段
**症状**：`pydantic.ValidationError: ... Character ...`
**原因**：Qwen 输出的 JSON 不符合 Pydantic schema。常见两种：
1. `event_type` / `role_type` 输出了不在枚举里的中文（例如"主角"而不是 `protagonist`）。
2. `importance` 输出 string `"3"` 而不是 int `3`。
**修法**：
- 把 Field description 写得更显式：`"必须是以下英文 enum 之一：protagonist/antagonist/supporting"`；
- 或者放宽类型：`role_type: str = Field(...)` 不强制 Literal——本 PoC 已经这样。

### Embedding dim mismatch
**症状**：`vector dimension mismatch: expected 4096, got 1024`（或反过来）
**原因**：`EMBEDDING_MODEL` 和 `EMBEDDING_DIM` 不匹配，或者之前跑过其他 embedding
模型在 Neo4j 里建了固定维度的向量索引。常见维度参考：
- `qwen/qwen3-embedding-8b` → 4096
- `qwen/qwen3-embedding-4b` → 2560
- `qwen/qwen3-embedding-0.6b` → 1024
- `openai/text-embedding-3-small` → 1536
- `openai/text-embedding-3-large` → 3072

**修法**：先在 `.env` 对齐 `EMBEDDING_MODEL` + `EMBEDDING_DIM`，然后**清空 Neo4j
重建索引**——向量索引一旦建好，dim 就锁死了：
```bash
docker compose down -v && docker compose up -d
```
或者在代码里：
```python
from graphiti_core.utils.maintenance.graph_data_operations import clear_data
await clear_data(client._graphiti.driver)
await client._graphiti.build_indices_and_constraints()
```

---

## Stage 2 — 本体 / 中文抽取迭代

### Character 缺失或多了无名角色
**症状**：`test_ontology_extracts_characters` 找不到"李静"或者抽出了"路人甲"。
**修法**：进 `ontology/character.py`，强化 docstring 里的 examples：
```python
"""...
Examples (必须抽取):
    - "李静走进来" → Character(name="李静")
    - "张医生说" → Character(name="张医生")
Examples (不要抽取):
    - "一个路人经过" → 跳过
    - "三个学生在聊天" → 跳过
    - "他/她/它/那个人" → 跳过
"""
```
然后重跑测试。**不要去测试里调整断言**。

### PlotEvent 没抽到关键事件
**症状**：`test_ontology_extracts_plot_event` 报"no PlotEvent mentions 领养"。
**修法**：
1. 先去 Neo4j Browser 看 `MATCH (e:PlotEvent) RETURN e`。如果完全为空 →
   prompt 没让 LLM 输出 PlotEvent。强化 `PlotEvent` 的 docstring + 给反例。
2. 如果有 PlotEvent 但措辞不含"领养"→ Qwen 用了同义词（"被收养"、"非亲生"等）。
   两种修法：a) 把测试断言放宽成 `any(k in desc for k in ["领养", "收养", "亲生"])`，
   b) 在 `CHINESE_EXTRACTION_INSTRUCTIONS` 里加"事件描述要保留原文关键词"。
   推荐 (b)，因为 (a) 等于改测试。

### 代词漏进图
**症状**：`get_nodes_by_label("Character")` 里出现了"她"、"他"。
**修法**：
1. 这是第一场，`_known_character_names()` 为空 → 没跑 coreference。
   修在 `CHINESE_EXTRACTION_INSTRUCTIONS` 第 3 条：明确说"代词不应作为独立实体"。
2. 如果是后续场次还漏，去 `chinese/coreference.py` 加强 prompt：
   "**所有**第三人称代词都必须替换；如果指代不明，标注 `[unclear]`"。

### `coreference_applied: True` 但效果不明显
**症状**：返回值显示跑了 coreference，但 Neo4j 里仍然能看到代词。
**原因**：Qwen-7B 可能误判代词指代，或者把对白也改了。
**排查**：
```python
from screenplay_memory.chinese.coreference import resolve_coreference
print(await resolve_coreference("李静走进来。她坐下。", ["李静"]))
# 期望: "李静走进来。李静坐下。"
```
如果 7B 表现差，考虑临时把 `CHAT_SMALL_MODEL` 换成更大的模型（例如 `qwen/qwen-2.5-72b-instruct`）。

---

## Stage 3 — 认知边界查询

### `test_query_zhang_wei_knows_after_revelation` 失败
**症状**：`facts_text` 是空字符串或不含"领养"。
**根因 99% 在 Stage 2**：Graphiti 没建出"张伟 → 知道 → 李静被领养"这条边。
**排查**：
```cypher
MATCH (a:Character {name:'张伟'})-[r]->(b)
WHERE a.group_id='test_project'
RETURN type(r), r.fact, r.valid_at, b.name
```
- 如果完全空 → Stage 2 抽取问题，先回去修
- 如果有边但 `fact` 不含"李静"或"领养" → 中文抽取指令需要"事件描述保留关键词"
- 如果 `valid_at` 是 null → 没事，cognitive query 已经容忍 null

### `test_query_zhou_yajing_does_not_know` 失败（误报）
**症状**：周雅静的 `knows_facts` 里出现了"寻找/找她"。
**原因**：cutoff 时间没起作用，`search` 把第 3 场后发生的事情也召回了。
**排查**：
```python
result = await client.query_cognitive("周雅静", at_scene_episode=2, at_scene_number=1)
print(result["query_metadata"]["cutoff"])
# 应该 ≈ 2020-01-01 + (2*10000 + 2*100) seconds
# = 2020-01-01 05:36:40 UTC
```
然后比对相关 edge 的 `valid_at`：如果 LLM 给的 `valid_at` 也都是这个范围里的合成时间，
正常；如果 `valid_at` 都是 null，子串"寻找"误中了也会触发。

**修法**：把 cognitive query 的字符串过滤改严，例如要求 `character` 出现
在 fact 的第一个分句里；或者从 `query_character_knowledge` 移除子串过滤，
完全靠 source/target uuid 匹配。

### `test_query_includes_known_characters` 返回空
**症状**：`knows_characters` 是 `[]`，期望含"李静"。
**排查**：
1. `result["query_metadata"]["edges_kept"]` 是 0 还是 >0？
2. 如果 >0 但 `knows_characters` 空 → `_resolve_other_character` 反查失败。
   打印 `edge.source_node_uuid` / `target_node_uuid`，确认 Neo4j 里存在这俩 UUID
   且节点 labels 含 `Character`。
3. 如果 `edges_kept` 是 0 → search 召回不够，把 `num_results` 临时调到 50 看看。

### `test_query_performance` 超时
**症状**：单次查询 > 3 秒。
**原因**：reranker 调远端 API + 嵌入重算。
**修法**：
- `num_results=20` 改成 10；
- 临时 skip 这条用例，先确保正确性测试全过（PRD §10：报告，不静默改测试）；
- 长期方案：换本地 reranker（bge-reranker），但超出 PoC 范围。

---

## 通用调试技巧

### 直接看 Neo4j Browser
任何抽取问题，第一步永远是：
```cypher
MATCH (n) WHERE n.group_id='test_project' RETURN n LIMIT 100
```
然后：
```cypher
MATCH (a)-[r]->(b) WHERE a.group_id='test_project' RETURN a,r,b LIMIT 100
```
肉眼看就能判断是抽取问题、关系问题、还是查询问题。

### 打开 Graphiti 的 LLM 调用日志
```python
import logging
logging.basicConfig(level=logging.DEBUG)
logging.getLogger("graphiti_core").setLevel(logging.DEBUG)
```
能看到每次发给 Qwen 的实际 prompt 和返回的 JSON——调 docstring 时关键。

### 单条用例 + `-s` 看 print
```bash
pytest tests/test_02_ontology.py::test_ontology_extracts_characters -v -s
```
`-s` 关掉 stdout capture，`print` 出来的中间状态能直接看到。

### 隔离测试间的污染
`memory_client` fixture 已经在前后各 `clear()` 一次。如果你怀疑还有污染，
手动:
```python
client = MemoryClient("test_project")
await client.clear()
# 然后 Neo4j Browser 确认空：
# MATCH (n) WHERE n.group_id='test_project' RETURN count(n)
```

---

## "我应该停下来报告" 的清单

PRD §10 明确："如果某个 Graphiti 功能不工作，不要绕过它伪造结果。"
以下情况**必须**停下来报告，不要自己加 workaround：

1. Stage 1 的英文污染测试失败 → 报告，等用户决定要不要 monkey-patch
2. Stage 2 迭代了 5 轮 docstring 还是有测试不过 → 报告，可能是 Qwen 能力上限
3. Stage 3 `graphiti.search` 召回明显不够 → 报告再切自定义 Cypher
4. 任何测试需要修改断言才能过 → 报告，不要改测试
5. Graphiti 抛 `NotImplementedError` 或类似的版本不兼容错误 → 报告，不要 fork
