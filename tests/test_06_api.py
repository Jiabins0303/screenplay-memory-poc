"""Phase 3 tests — FastAPI surface.

Uses httpx's ASGITransport so the app runs in-process against the live
Neo4j container. The LLM is expensive, so we skip the full ``ingest``
route here (covered in test_01/02/04) and instead seed nodes/edges
directly via the client's Cypher driver before exercising edit endpoints.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from api.deps import ClientCache
from api.main import app
from screenplay_memory.client import MemoryClient

BASE_URL = "http://testserver"
PROJECT_ID = "test_api"


@pytest_asyncio.fixture
async def api_client():
    """Async HTTP client bound to the FastAPI app."""
    app.state.client_cache = ClientCache()
    cleanup_client = MemoryClient(project_id=PROJECT_ID)
    await cleanup_client.clear()
    await cleanup_client.close()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=BASE_URL) as ac:
        yield ac
    cleanup_client = MemoryClient(project_id=PROJECT_ID)
    await cleanup_client.clear()
    await cleanup_client.close()
    await app.state.client_cache.close_all()


# --- Health / projects -----------------------------------------------------


@pytest.mark.asyncio
async def test_healthz(api_client):
    r = await api_client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_create_project_with_explicit_id(api_client):
    r = await api_client.post("/projects", json={"project_id": PROJECT_ID})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["project_id"] == PROJECT_ID


@pytest.mark.asyncio
async def test_list_projects_includes_created(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    r = await api_client.get("/projects")
    assert r.status_code == 200
    ids = [p["project_id"] for p in r.json()]
    assert PROJECT_ID in ids


# --- Ontology --------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_ontology_default_detail(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    r = await api_client.get(f"/projects/{PROJECT_ID}/ontology?layer=detail")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "default"
    names = {e["name"] for e in body["spec"]["entities"]}
    assert "Character" in names


@pytest.mark.asyncio
async def test_put_ontology_and_read_back(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    spec = {
        "entities": [
            {"name": "Mystery", "description": "test",
             "fields": [{"name": "clue", "type": "str", "optional": True,
                         "description": ""}]}
        ],
        "edges": [],
    }
    r = await api_client.put(
        f"/projects/{PROJECT_ID}/ontology?layer=detail", json=spec
    )
    assert r.status_code == 200, r.text

    r = await api_client.get(f"/projects/{PROJECT_ID}/ontology?layer=detail")
    body = r.json()
    assert body["source"] == "saved"
    assert body["spec"]["entities"][0]["name"] == "Mystery"


@pytest.mark.asyncio
async def test_put_ontology_rejects_bad_type(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    spec = {"entities": [{"name": "X", "fields": [{"name": "y", "type": "dict"}]}],
            "edges": []}
    r = await api_client.put(
        f"/projects/{PROJECT_ID}/ontology?layer=detail", json=spec
    )
    assert r.status_code == 400


# --- Graph + edits ---------------------------------------------------------


async def _seed(client: MemoryClient, specs: list[dict]) -> None:
    async with client._graphiti.driver.session() as sess:
        for spec in specs:
            label = spec.pop("label", "Entity")
            await sess.run(
                f"CREATE (n:{label} $props)",
                props={"group_id": client.project_id, **spec},
            )


async def _fresh_client() -> MemoryClient:
    return MemoryClient(project_id=PROJECT_ID)


@pytest.mark.asyncio
async def test_graph_read(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    client = await app.state.client_cache.get(PROJECT_ID)
    await _seed(
        client,
        [
            {"uuid": "a", "name": "李静", "label": "Character"},
            {"uuid": "b", "name": "张伟", "label": "Character"},
        ],
    )
    # Seed an edge via the driver so we also verify edge read-back.
    async with client._graphiti.driver.session() as sess:
        await sess.run(
            """
            MATCH (a {uuid: 'a', group_id: $gid})
            MATCH (b {uuid: 'b', group_id: $gid})
            CREATE (a)-[:KNOWS {uuid: 'e1', group_id: $gid, name: '认识'}]->(b)
            """,
            gid=PROJECT_ID,
        )

    r = await api_client.get(f"/projects/{PROJECT_ID}/graph?layer=detail")
    assert r.status_code == 200, r.text
    body = r.json()
    names = {n["name"] for n in body["nodes"]}
    assert {"李静", "张伟"}.issubset(names)
    assert any(e["type"] == "KNOWS" for e in body["edges"])


@pytest.mark.asyncio
async def test_patch_node_rename(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    client = await app.state.client_cache.get(PROJECT_ID)
    await _seed(client, [{"uuid": "n1", "name": "老名", "label": "Character"}])

    r = await api_client.patch(
        f"/projects/{PROJECT_ID}/nodes/n1", json={"name": "新名"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "新名"


@pytest.mark.asyncio
async def test_delete_node_404(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    r = await api_client.delete(f"/projects/{PROJECT_ID}/nodes/does-not-exist")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_and_delete_edge_endpoints(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    client = await app.state.client_cache.get(PROJECT_ID)
    await _seed(
        client,
        [
            {"uuid": "a", "name": "A", "label": "Character"},
            {"uuid": "b", "name": "B", "label": "Character"},
        ],
    )
    r = await api_client.post(
        f"/projects/{PROJECT_ID}/edges",
        json={"source_uuid": "a", "target_uuid": "b", "name": "认识", "fact": ""},
    )
    assert r.status_code == 200, r.text
    edge_uuid = r.json()["uuid"]

    r = await api_client.delete(f"/projects/{PROJECT_ID}/edges/{edge_uuid}")
    assert r.status_code == 200
    assert r.json()["deleted"] == 1


@pytest.mark.asyncio
async def test_merge_nodes_endpoint(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    client = await app.state.client_cache.get(PROJECT_ID)
    await _seed(
        client,
        [
            {"uuid": "src", "name": "alias", "label": "Character"},
            {"uuid": "dst", "name": "canon", "label": "Character"},
        ],
    )
    r = await api_client.post(
        f"/projects/{PROJECT_ID}/nodes/merge",
        json={"src_uuid": "src", "dst_uuid": "dst"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["uuid"] == "dst"


# --- Query -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_query_cognitive_missing_args_returns_400(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    r = await api_client.post(
        f"/projects/{PROJECT_ID}/query",
        json={"mode": "cognitive", "question": ""},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_query_search_empty_returns_400(api_client):
    await api_client.post("/projects", json={"project_id": PROJECT_ID})
    r = await api_client.post(
        f"/projects/{PROJECT_ID}/query",
        json={"mode": "search", "question": ""},
    )
    assert r.status_code == 400
