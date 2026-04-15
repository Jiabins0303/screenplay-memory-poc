# 剧本记忆层 PoC

验证 Graphiti + Neo4j + Qwen2.5 能否构建中文剧本知识图谱的最小原型。

## 30 分钟快速开始

### 1. 环境准备
- Python 3.10+
- Docker
- 阿里云 DashScope API Key（Qwen + Embedding）

### 2. 启动 Neo4j
```bash
docker compose up -d
```
访问 http://localhost:7474 验证（neo4j / testpassword）。

### 3. 安装依赖
```bash
pip install -e ".[dev]"
```

### 4. 配置
```bash
cp .env.example .env
# 编辑 .env 填入 QWEN_API_KEY 和 EMBEDDING_API_KEY
```

### 5. 跑测试（按阶段）
```bash
# Stage 1：基座测试 — 不做任何剧本适配
pytest tests/test_01_baseline.py -v

# Stage 2：本体 + 中文适配（Stage 1 全过后）
pytest tests/test_02_ontology.py -v

# Stage 3：认知边界查询（Stage 2 全过后）
pytest tests/test_03_query.py -v
```

## 测试通过的含义

- ✅ Stage 1 全过：基座技术栈可行（Graphiti + Qwen 能处理中文）
- ✅ Stage 2 全过：剧本本体设计可行
- ✅ Stage 3 全过：业务查询可行
- 三个全过：可以扩展为完整产品

## Stage 1 手动检查

跑完 `pytest tests/test_01_baseline.py` 后，**必须**打开 Neo4j Browser
肉眼检查节点是不是中文：

1. http://localhost:7474 登录
2. 运行 `MATCH (n) RETURN n LIMIT 50`
3. 确认节点 `name` 属性是「李静」「张伟」这种中文，不是 `Li Jing` / `Zhang Wei`

如果是英文 → **停下来报告**，不要往 Stage 2 推进。

## 文档

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — 详细技术文档（数据流、模块责任、决策细节）
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — 常见症状与修法

## 已知限制

- 只支持单项目（默认 `project_id="test_project"`）
- 只验证显式信息抽取，不做隐式推理
- 查询性能未优化（依赖 Graphiti hybrid search，未做 Cypher 兜底）
- 没有别名字典（"李静"和"静姐"会被建成两个 Character 节点）
