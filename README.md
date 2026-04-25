# 剧本记忆层 PoC

验证 **Graphiti + Neo4j + Qwen2.5(via OpenRouter)** 能否构建中文剧本知识图谱的最小原型。

> **Chat + Embedding 都走 OpenRouter**,一把 key 覆盖两边,方便后续横向对比 Claude / GPT / Llama。

---

## 目录

- [前置要求](#前置要求)
- [详细运行步骤](#详细运行步骤)
  - [Step 1 — 获取 OpenRouter API Key](#step-1--获取-openrouter-api-key)
  - [Step 2 — 启动 Neo4j](#step-2--启动-neo4j)
  - [Step 3 — 安装 Python 依赖](#step-3--安装-python-依赖)
  - [Step 4 — 配置环境变量](#step-4--配置环境变量)
  - [Step 5 — 跑 Stage 1(基座测试)](#step-5--跑-stage-1基座测试)
  - [Step 6 — 肉眼验证 Neo4j(强制)](#step-6--肉眼验证-neo4j强制)
  - [Step 7 — 跑 Stage 2(本体 + 中文适配)](#step-7--跑-stage-2本体--中文适配)
  - [Step 8 — 跑 Stage 3(认知边界查询)](#step-8--跑-stage-3认知边界查询)
- [切换模型](#切换模型)
- [文档索引](#文档索引)
- [已知限制](#已知限制)

---

## 前置要求

| 工具 | 版本 | 检查命令 |
|---|---|---|
| Python | ≥ 3.10 | `python3 --version` |
| Docker | ≥ 20.10 + Docker Compose v2 | `docker --version && docker compose version` |
| OpenRouter Account | 有效 API key + 少量 credits(~$1 跑完全部三阶段够用) | 见 Step 1 |

推荐 macOS / Linux。Windows 用户建议在 WSL2 里跑。

## 最简静态演示版

如果只是给投资人、同事或远程评审看交互体验，**不需要 Docker / Neo4j / OpenRouter Key**。前端有一套内置示例数据，可以编译成纯静态站点：

```bash
cd web
pnpm install
pnpm build:demo
pnpm preview
```

`pnpm build:demo` 会设置 `VITE_DEMO_ONLY=true`，生成的 `web/dist/` 可以直接部署到 GitHub Pages、Cloudflare Pages、Tencent EdgeOne Pages 等静态托管平台。静态演示版会：

- 展示示例项目、双层图谱、本体定义、认知边界矩阵和对话查询示例
- 模拟剧本导入进度
- 隐藏后端设置、新建真实项目和写入型编辑
- 不发起任何 FastAPI / Neo4j / OpenRouter 请求

真实抽取、真实查询和节点编辑仍然走下面的 Docker 后端流程。

---

## 详细运行步骤

> 总耗时约 **30 分钟**(不含 OpenRouter 注册 + 充值)。所有命令默认在项目根目录 `screenplay-memory-poc/` 下执行。

### Step 1 — 获取 OpenRouter API Key

1. 打开 https://openrouter.ai → 右上角注册(Google / GitHub 登录即可)
2. 进入 https://openrouter.ai/settings/credits → 充 $1-5(跑 PoC 足够,Qwen 系列非常便宜)
3. 进入 https://openrouter.ai/settings/keys → **Create Key** → 起个名字(如 `screenplay-poc`)
4. 复制生成的 key(形如 `sk-or-v1-xxxxxxxx...`)—— **只显示一次,妥善保存**

> **可选验证**:用 curl 发一个 tiny 请求确认 key 有效:
> ```bash
> curl https://openrouter.ai/api/v1/chat/completions \
>   -H "Authorization: Bearer sk-or-v1-YOUR_KEY" \
>   -H "Content-Type: application/json" \
>   -d '{"model":"qwen/qwen-2.5-7b-instruct","messages":[{"role":"user","content":"说你好"}]}'
> ```
> 预期看到一段中文"你好"类回复。如果报 `401` → key 不对;`402` → 余额不足。

---

### Step 2 — 启动 Neo4j

```bash
docker compose up -d
```

**预期输出**:
```
[+] Running 2/2
 ✔ Network screenplay-memory-poc_default  Created
 ✔ Container screenplay-neo4j             Started
```

等 **10-15 秒** 让 Neo4j 完成初始化,然后验证:

```bash
docker compose ps
```

**预期**:`screenplay-neo4j` 状态是 `running` 或 `healthy`。

**浏览器验证**(必做):
1. 打开 http://localhost:7474
2. 看到 Neo4j Browser 登录页面
3. 输入:
   - Connect URL: `bolt://localhost:7687`
   - Username: `neo4j`
   - Password: `testpassword`
4. 登录后左侧看到空数据库 → ✅ Neo4j 就绪

> **如果连不上**:看 `docker logs screenplay-neo4j` 里有无 `Started`。遇到 `port in use` 先 `lsof -i :7687` 查占用进程。详见 [TROUBLESHOOTING.md — Neo4j 连接](TROUBLESHOOTING.md#neo4j-连接)。

---

### Step 3 — 安装 Python 依赖

```bash
# 推荐先建虚拟环境(避免污染系统 Python)
python3 -m venv .venv
source .venv/bin/activate   # macOS/Linux
# .venv\Scripts\activate    # Windows

# 装本包 + 开发依赖
pip install -e ".[dev]"
```

**预期**:看到 `graphiti-core`、`neo4j`、`pydantic`、`openai`、`python-dotenv`、`pytest`、`pytest-asyncio`、`ruff` 被依次装上,最后一行:
```
Successfully installed screenplay-memory-0.1.0 ...
```

**验证**:
```bash
python3 -c "from graphiti_core import Graphiti; print('OK')"
```
输出 `OK` → ✅ 依赖就绪。

---

### Step 4 — 配置环境变量

```bash
cp .env.example .env
```

然后用任意编辑器打开 `.env`,**只需要填一行**:
```bash
OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE
```

其他变量保持默认即可。完整字段说明:

| 变量 | 默认值 | 什么时候改 |
|---|---|---|
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j 跑在别的机器/端口 |
| `NEO4J_USER` / `NEO4J_PASSWORD` | `neo4j` / `testpassword` | 改了 `docker-compose.yml` 里的密码 |
| `OPENROUTER_API_KEY` | **(必填,无默认)** | 永远要填 |
| `OPENROUTER_API_BASE` | `https://openrouter.ai/api/v1` | 几乎不需要改 |
| `CHAT_MODEL` | `qwen/qwen-2.5-72b-instruct` | 想测 Claude / GPT / Llama 时改 |
| `CHAT_SMALL_MODEL` | `qwen/qwen-2.5-7b-instruct` | 代词消解专用,通常无需改 |
| `EMBEDDING_MODEL` | `qwen/qwen3-embedding-8b` | 换 embedding 时改(见"切换模型") |
| `EMBEDDING_DIM` | `4096` | **必须**和 `EMBEDDING_MODEL` 的原生维度一致 |

**验证 env 加载正常**:
```bash
python3 -c "
from screenplay_memory.config import Settings
s = Settings.from_env()
print('chat :', s.chat_model)
print('embed:', s.embedding_model, '/', s.embedding_dim, 'dim')
print('key  :', s.openrouter_api_key[:12] + '...')
"
```
**预期**:
```
chat : qwen/qwen-2.5-72b-instruct
embed: qwen/qwen3-embedding-8b / 4096 dim
key  : sk-or-v1-xx...
```
如果报 `RuntimeError: Missing required env vars` → `.env` 没填 `OPENROUTER_API_KEY`。

---

### Step 5 — 跑 Stage 1(基座测试)

Stage 1 的目标:**裸跑** Graphiti,证明"OpenRouter + Qwen + Neo4j"这一路技术栈能处理中文。不加任何剧本适配层。

```bash
pytest tests/test_01_baseline.py -v
```

**预期输出**(约 30-60 秒,取决于 OpenRouter 延迟):
```
tests/test_01_baseline.py::test_baseline_chinese_ingestion PASSED
tests/test_01_baseline.py::test_baseline_chinese_search PASSED
tests/test_01_baseline.py::test_baseline_no_english_pollution PASSED

==== 3 passed in 45.21s ====
```

**如果失败**,去 [TROUBLESHOOTING.md — Graphiti × OpenRouter](TROUBLESHOOTING.md#graphiti--openrouter) 对症:
- `ImportError: OpenAIGenericClient` → graphiti-core 版本太旧,升到 ≥ 0.3
- `401 Unauthorized` → key 无效或 reranker 没显式传
- `test_baseline_no_english_pollution` 失败 → 节点名被翻成英文了,**先做 Step 6 验证**再决定怎么办

---

### Step 6 — 肉眼验证 Neo4j(强制)

> **这一步不能跳过**。自动测试只检查"至少有一个中文节点",但不能保证**全部**节点是中文。肉眼检查才是 Stage 1 的真正验收。

1. 打开 http://localhost:7474 重新登录
2. 在顶部命令栏输入:
   ```cypher
   MATCH (n) WHERE n.group_id='test_project' RETURN n LIMIT 50
   ```
3. 点击运行(或按 Ctrl+Enter)
4. 看右侧节点 `name` 属性:

| 现象 | 判断 | 下一步 |
|---|---|---|
| 节点名是「李静」「张伟」这种中文 | ✅ 通过 | 进 Step 7 |
| 节点名是 `Li Jing`、`Zhang Wei` | ❌ 英文污染 | **停下来**,进 [TROUBLESHOOTING — Stage 1 失败](TROUBLESHOOTING.md#stage-1-失败test_baseline_no_english_pollution) |
| 节点稀少或为空 | ❌ 抽取失败 | 看 `docker logs screenplay-neo4j` + 看 pytest 有没有 WARNING |
| 节点名混杂中英文 | ⚠️ 部分污染 | 当作失败处理 |

**为什么这一步这么严格**:如果基座阶段 Qwen 就把名字翻译成英文,后面再怎么堆本体也救不回。现在修好(加中文 prompt 注入),比测到 Stage 3 再回来调便宜 10 倍。

---

### Step 7 — 跑 Stage 2(本体 + 中文适配)

```bash
pytest tests/test_02_ontology.py -v
```

**预期**(约 60-120 秒):
```
tests/test_02_ontology.py::test_ontology_extracts_characters PASSED
tests/test_02_ontology.py::test_ontology_extracts_plot_event PASSED
tests/test_02_ontology.py::test_ontology_creates_relationships PASSED
tests/test_02_ontology.py::test_ontology_pronoun_resolution PASSED

==== 4 passed in 95.33s ====
```

Stage 2 和 Stage 1 不同的地方:
- 注入了 `ENTITY_TYPES`(Character / Scene / PlotEvent 的 Pydantic 类)
- 注入了 `CHINESE_EXTRACTION_INSTRUCTIONS` 作为 `source_description`
- 跑了代词消解预处理

**一次过是运气好**,更常见是某一条 fail,要去调 `src/screenplay_memory/ontology/*.py` 里的 Pydantic docstring 或 `chinese/prompts.py` 里的中文指令。详细修法在 [TROUBLESHOOTING — Stage 2 迭代](TROUBLESHOOTING.md#stage-2--本体--中文抽取迭代)。

**迭代完之后重跑**:
```bash
# 重跑前不用清库,memory_client fixture 会前后各 clear() 一次
pytest tests/test_02_ontology.py -v
```

---

### Step 8 — 跑 Stage 3(认知边界查询)

```bash
pytest tests/test_03_query.py -v
```

**预期**(约 90-180 秒,5 个用例):
```
tests/test_03_query.py::test_query_returns_structured_result PASSED
tests/test_03_query.py::test_query_zhang_wei_knows_after_revelation PASSED
tests/test_03_query.py::test_query_zhou_yajing_does_not_know PASSED
tests/test_03_query.py::test_query_includes_known_characters PASSED
tests/test_03_query.py::test_query_performance PASSED

==== 5 passed in 142.10s ====
```

**重点关注**:
- `test_query_zhang_wei_knows_after_revelation` — 最核心的业务语义测试
- `test_query_performance` — 断言 < 3s,OpenRouter 链路可能偶发 flake;如果偶尔失败重跑一次就好;稳定失败才是真 bug

失败诊断见 [TROUBLESHOOTING — Stage 3](TROUBLESHOOTING.md#stage-3--认知边界查询)。

---

## 测试通过的含义

| 状态 | 含义 |
|---|---|
| ✅ Stage 1 全过 + Neo4j 肉眼中文 | 基座技术栈可行(OpenRouter + Qwen + Graphiti + Neo4j 能处理中文) |
| ✅ Stage 2 全过 | 剧本本体设计可行(Character / Scene / PlotEvent + 中文指令足以支撑抽取) |
| ✅ Stage 3 全过 | 业务查询可行(时序边界 + 反查关系能回答"角色在某时刻知道什么") |
| 三个都过 | 可以扩展为完整产品 |

---

## 切换模型

**Chat 和 embedding 都走 OpenAI 兼容接口**,所以换模型只改 `.env`,代码一行不动。

### 换 chat 模型
```bash
# 换 Claude
CHAT_MODEL=anthropic/claude-sonnet-4.6
CHAT_SMALL_MODEL=anthropic/claude-haiku-4.5

# 换 GPT
CHAT_MODEL=openai/gpt-4.1
CHAT_SMALL_MODEL=openai/gpt-4.1-mini

# 换 Llama
CHAT_MODEL=meta-llama/llama-4-405b-instruct
CHAT_SMALL_MODEL=meta-llama/llama-4-8b-instruct
```
重跑 `pytest tests/test_01_baseline.py -v` 即可。

### 换 embedding 模型(有额外步骤)
```bash
# 换 OpenAI
EMBEDDING_MODEL=openai/text-embedding-3-large
EMBEDDING_DIM=3072

# 换小号 Qwen 省钱
EMBEDDING_MODEL=qwen/qwen3-embedding-0.6b
EMBEDDING_DIM=1024
```

**关键**:embedding 维度变了,Neo4j 里的向量索引是锁死的,**必须清库重建**:
```bash
docker compose down -v && docker compose up -d
# 等 10-15 秒让 Neo4j 再次就绪
pytest tests/test_01_baseline.py -v
```

常见 embedding 模型的原生维度参考:

| 模型 | 原生维度 |
|---|---|
| `qwen/qwen3-embedding-8b` | 4096 |
| `qwen/qwen3-embedding-4b` | 2560 |
| `qwen/qwen3-embedding-0.6b` | 1024 |
| `openai/text-embedding-3-large` | 3072 |
| `openai/text-embedding-3-small` | 1536 |

> 想知道 OpenRouter 当前支持哪些模型:https://openrouter.ai/models

---

## 文档索引

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — 详细技术文档:数据流、模块责任、Graphiti 客户端选型、Stage 3 查询管线、已知风险
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — 按"症状 → 原因 → 修法"组织,从错误信息反查
- [`.env.example`](.env.example) — 所有环境变量及默认值

---

## 已知限制

- 只支持单项目(默认 `project_id="test_project"`)
- 只验证显式信息抽取,不做隐式推理
- 查询性能未优化(依赖 Graphiti hybrid search,未做 Cypher 兜底)
- 没有别名字典("李静"和"静姐"会被建成两个 Character 节点)
- OpenRouter 在中国大陆访问可能不稳定,延迟比 DashScope 直连高
