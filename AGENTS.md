# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this project is

PoC that validates **Graphiti + Neo4j + Qwen2.5 (via OpenRouter)** as a Chinese-screenplay knowledge-graph stack. Both chat and embedding go through OpenRouter's OpenAI-compatible endpoint so swapping Codex / GPT / Llama is a `.env` change, not a code change. Code comments and prompts are Chinese by design — do not translate them when editing.

Authoritative deep docs: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`README.md`](README.md), [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). Prefer reading these before refactoring.

## Common commands

```bash
# Bring up Neo4j 5.26 (volume-mounted at ./data/neo4j)
docker compose up -d
docker compose down -v   # destroys the volume — required when EMBEDDING_DIM changes

# Install (editable) + dev deps
pip install -e ".[dev]"

# Run a single stage
pytest tests/test_01_baseline.py -v       # Stage 1: bare Graphiti + Chinese
pytest tests/test_02_ontology.py -v       # Stage 2: ontology + Chinese adapter
pytest tests/test_03_query.py -v          # Stage 3: cognitive-boundary query

# Run a single test
pytest tests/test_03_query.py::test_query_zhang_wei_knows_after_revelation -v

# Lint
ruff check src tests
```

`pytest.ini_options.asyncio_mode = "auto"` is set — do not add `@pytest.mark.asyncio`; fixtures are already async-aware via `tests/conftest.py`.

Neo4j Browser: http://localhost:7474 (user `neo4j` / pass `testpassword`). Use this Cypher to inspect what the current `project_id` holds:

```cypher
MATCH (n) WHERE n.group_id='test_project' RETURN n LIMIT 50
```

## Architecture in one screen

`MemoryClient` (`src/screenplay_memory/client.py`) is the only public facade. Every `ingest()` call runs this pipeline:

1. `_known_character_names()` — Cypher lookup of existing `:Character` nodes in this `group_id`
2. `resolve_coreference(text, known)` — Qwen-7B rewrites 他/她/它/他们 into names (skipped when `known` is empty; leaves dialogue inside quotes untouched)
3. Prepend `SCENE_HEADER_TEMPLATE` (`[本段为第X集第Y场]`) — this sentence is what makes Graphiti extract a `:Scene` node; without it, Scene is a "ghost" type that never materializes
4. `graphiti.add_episode(...)` with `entity_types=ENTITY_TYPES`, `edge_types=EDGE_TYPES`, `source_description=CHINESE_EXTRACTION_INSTRUCTIONS`, and a synthetic `reference_time = _BASE_EPOCH + episode*10000s + scene*100s`

Stage 3 query (`query_character_knowledge` in `queries/cognitive.py`): hybrid `graphiti.search` → filter by `valid_at < cutoff` and (`invalid_at is None` or `invalid_at > cutoff`) → reverse-lookup counterpart nodes via `source_node_uuid` / `target_node_uuid`. `valid_at = None` edges are kept (LLM rarely extracts explicit time words from screenplays); the synthetic per-scene `reference_time` carries ordering instead.

Package layout (`src/screenplay_memory/`): `config.py` (frozen `Settings` dataclass, only place that reads env), `client.py` (facade), `ontology/` (Pydantic entity + edge schemas — docstrings ARE the prompt), `chinese/` (`prompts.py` constants + `coreference.py` pure function), `queries/cognitive.py`, `annotations.py` (witness-scope tagging used during ingest).

### Non-obvious rules that bite if ignored

- **Ship pure baseline before any adaptation.** Stage 1 (`test_01_baseline.py`) deliberately passes no `entity_types`, no instructions, no preprocessing. After it passes, open Neo4j Browser and visually confirm node names are CJK before touching Stage 2. Auto tests only check "at least one Chinese node", not "all nodes Chinese". See `feedback_baseline_first.md` in auto-memory.
- **Reranker must be passed explicitly** to `Graphiti(...)` as `cross_encoder=OpenAIRerankerClient(client=llm_client, config=llm_config)`. Without it, Graphiti defaults to the real OpenAI endpoint and fails `search` with 401.
- **Project isolation is by `group_id`, not database.** `MemoryClient.clear()` runs `MATCH (n) WHERE n.group_id=$gid DETACH DELETE n`; do not swap in `graphiti.clear_data(driver)` — it wipes everything and breaks parallel tests.
- **Ontology docstrings are prompts.** Editing a `Field(description=...)` or class docstring in `ontology/*.py` directly changes extraction behavior. Iterate there, not in client code.
- **When Chinese entity extraction regresses** (names translated, pronouns become nodes), fix `chinese/prompts.py` first. The coreference pass only runs when prior characters exist; scene 1 extraction quality is entirely on `CHINESE_EXTRACTION_INSTRUCTIONS`.
- **Changing `EMBEDDING_MODEL` requires changing `EMBEDDING_DIM` to its native size** AND `docker compose down -v` to rebuild the vector index. Reference dims: qwen3-embedding-8b=4096, 4b=2560, 0.6b=1024, openai text-embedding-3-large=3072, -small=1536.
- **Neo4j must be ≥ 5.18** for `vector.similarity.cosine()` (Graphiti requirement). docker-compose pins 5.26-community; upgrading existing local data volumes may require `docker compose down -v`.
- **Graphiti has no `custom_extraction_instructions` param.** Instructions piggyback on `source_description`. Do not add a parameter that doesn't exist; monkey-patching `graphiti_core.prompts` is the documented escape hatch but requires explicit user approval (ARCHITECTURE §3.3).

## Two-layer KG + web demo (post-April 2026)

Two Graphiti layers now share one Neo4j database:

- **Detail layer** (`group_id = project_id`) — the original Character / Scene / PlotEvent ontology, one `add_episode` per scene.
- **High-level "beat" layer** (`group_id = f"{project_id}__hl"`) — Beat / Arc / Theme with BeatRelation edges; one `add_episode` per whole script. Defined in `src/screenplay_memory/ontology_hl/` + `chinese/prompts_hl.py`. Entry point: `MemoryClient.ingest_hl(scenes)`.
- `annotations_hl.py::attach_beats_to_scenes` writes cross-layer `(:Beat)-[:COVERS]->(:Scene)` edges with `group_id='bridge'`.
- `MemoryClient.clear()` now wipes both layers plus any saved `(:OntologyConfig)` node for this project.

**Runtime ontology customization** (`ontology_customization.py`): users can save an entity/edge spec per `(project_id, layer)` in Neo4j as `(:OntologyConfig {spec})`. `MemoryClient.__init__` accepts `entity_types_override` / `edge_types_override` / `hl_*_override` kwargs; when `None`, loads the saved spec, then falls back to the module defaults. **`spec_to_pydantic` has a strict type whitelist** — `str / int / float / bool / list[str] / list[int] / Literal[...]` only. Extending the whitelist is a security-sensitive edit.

**Post-ingest edits** live in `src/screenplay_memory/edits.py` — pure Cypher, always `group_id`-scoped. `merge_nodes` relies on APOC (`apoc.refactor.mergeNodes`), which is bundled in the docker-compose Neo4j image.

**FastAPI layer** (`api/`): `uvicorn api.main:app --port 8000`. Endpoints under `/projects/{pid}` mirror the backend modules. SSE ingest progress via `sse-starlette`. `docker compose up` starts Neo4j + the API together. CORS origins are read from `API_ALLOWED_ORIGINS` (default `*` in dev).

**Frontend** (`web/`): Vite + React 18 + TypeScript + Tailwind + pnpm. 3D graph via `3d-force-graph` (vanilla, wrapped in a React ref; the TS def exports a class, but the actual factory is curry — cast through `unknown` to call it). Backend URL configurable per-user via the settings modal (localStorage `apiBase`). Build: `pnpm build` → `web/dist/` for Cloudflare Pages deploy.

### Tests added

- `tests/test_04_hl_ingest.py` — HL ingest + bridge (LLM, ~90s)
- `tests/test_05_customization.py` — spec_to_pydantic + Neo4j save/load
- `tests/test_05_edits.py` — rename / merge / delete / add_edge round-trips
- `tests/test_06_api.py` — FastAPI TestClient coverage for every non-LLM endpoint

### Known non-obvious pitfalls from this build

- **Graphiti protects `name`, `summary`, etc. on EntityNode.** Any Pydantic class in an ontology dict that declares those fields raises `EntityTypeValidationError`. That's why Beat uses `beat_summary`, Theme uses `theme_name`. If you add a new entity type, avoid `name / summary / labels / uuid / group_id / attributes / created_at / name_embedding`.
- **Neo4j undirected match double-counts.** `MATCH ()-[r]-()` binds `r` twice per directed relation. Use `()-[]->()` for counts and for the `delete_edge` Cypher (a bug we hit in test_05_edits; directed match is the fix).
- **FastAPI TestClient and lifespan.** `tests/test_06_api.py` initialises `app.state.client_cache = ClientCache()` manually in the fixture because httpx's ASGITransport does not run the lifespan context.

## Swapping models

Change `.env` only:

```
CHAT_MODEL=anthropic/Codex-sonnet-4.6
CHAT_SMALL_MODEL=anthropic/Codex-haiku-4.5
# or openai/gpt-4.1 + openai/gpt-4.1-mini, meta-llama/llama-4-*, etc.
```

For embedding swaps, also update `EMBEDDING_DIM` and rebuild the volume (see rule above).
