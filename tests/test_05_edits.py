"""Phase 1 tests — post-ingest graph edits.

These bypass the LLM ingest pipeline and seed nodes directly via Cypher
so the test can finish in seconds. Each test case builds its own fixture
graph under ``group_id='test_project'`` (the ``memory_client`` fixture
already wipes that group before+after).
"""

from __future__ import annotations

import pytest

from screenplay_memory.edits import (
    EditError,
    add_edge,
    delete_edge,
    delete_node,
    merge_nodes,
    rename_node,
    update_node_props,
)


async def _seed_nodes(client, specs: list[dict]) -> None:
    """Insert bare nodes. ``specs`` = list of {uuid, name, label, ...}."""
    async with client._graphiti.driver.session() as sess:
        for spec in specs:
            label = spec.pop("label", "Entity")
            await sess.run(
                f"CREATE (n:{label} $props)",
                props={"group_id": client.project_id, **spec},
            )


async def _count_nodes(client, name: str) -> int:
    async with client._graphiti.driver.session() as sess:
        result = await sess.run(
            "MATCH (n {group_id: $gid, name: $name}) RETURN count(n) AS c",
            gid=client.project_id,
            name=name,
        )
        row = await result.single()
    return row["c"] if row else 0


async def _edge_count(client) -> int:
    # Direction matters: `()-[]-()` is undirected, which double-counts every
    # directed edge. Use `()-[]->()` so each edge contributes once.
    async with client._graphiti.driver.session() as sess:
        result = await sess.run(
            "MATCH ()-[r {group_id: $gid}]->() RETURN count(r) AS c",
            gid=client.project_id,
        )
        row = await result.single()
    return row["c"] if row else 0


@pytest.mark.asyncio
async def test_rename_node(memory_client):
    await _seed_nodes(
        memory_client, [{"uuid": "n1", "name": "李静", "label": "Character"}]
    )
    result = await rename_node(memory_client._graphiti, memory_client.project_id,
                               "n1", "李静(化名)")
    assert result["name"] == "李静(化名)"
    assert await _count_nodes(memory_client, "李静(化名)") == 1
    assert await _count_nodes(memory_client, "李静") == 0


@pytest.mark.asyncio
async def test_rename_missing_raises(memory_client):
    with pytest.raises(EditError):
        await rename_node(memory_client._graphiti, memory_client.project_id,
                          "does-not-exist", "新名字")


@pytest.mark.asyncio
async def test_update_node_props_ignores_protected_keys(memory_client):
    await _seed_nodes(
        memory_client,
        [{"uuid": "n1", "name": "张伟", "label": "Character", "role_type": "supporting"}],
    )
    result = await update_node_props(
        memory_client._graphiti, memory_client.project_id, "n1",
        {"role_type": "protagonist", "uuid": "hacked", "group_id": "other"},
    )
    assert result["role_type"] == "protagonist"
    # Protected fields must not have been overwritten.
    assert result["uuid"] == "n1"
    assert result["group_id"] == memory_client.project_id


@pytest.mark.asyncio
async def test_delete_node(memory_client):
    await _seed_nodes(
        memory_client, [{"uuid": "n1", "name": "临时角色", "label": "Character"}]
    )
    deleted = await delete_node(memory_client._graphiti, memory_client.project_id, "n1")
    assert deleted == 1
    assert await _count_nodes(memory_client, "临时角色") == 0


@pytest.mark.asyncio
async def test_delete_node_cross_project_isolation(memory_client):
    # Seed a node in a DIFFERENT project; deleting it via this client's
    # project_id must fail (and must not touch the other project).
    async with memory_client._graphiti.driver.session() as sess:
        await sess.run(
            "CREATE (n:Character {uuid: 'x', name: '他人', group_id: 'other_proj'})"
        )
    try:
        with pytest.raises(EditError):
            await delete_node(
                memory_client._graphiti, memory_client.project_id, "x"
            )
        # Still there in the other project.
        async with memory_client._graphiti.driver.session() as sess:
            result = await sess.run(
                "MATCH (n {uuid: 'x', group_id: 'other_proj'}) RETURN count(n) AS c"
            )
            row = await result.single()
        assert row["c"] == 1
    finally:
        # Clean up the other-project fixture so it doesn't pollute later tests.
        async with memory_client._graphiti.driver.session() as sess:
            await sess.run(
                "MATCH (n {group_id: 'other_proj'}) DETACH DELETE n"
            )


@pytest.mark.asyncio
async def test_add_and_delete_edge(memory_client):
    await _seed_nodes(
        memory_client,
        [
            {"uuid": "a", "name": "李静", "label": "Character"},
            {"uuid": "b", "name": "张伟", "label": "Character"},
        ],
    )
    edge = await add_edge(
        memory_client._graphiti, memory_client.project_id,
        "a", "b", name="认识", fact="在咖啡馆第一次见面",
    )
    assert await _edge_count(memory_client) == 1

    deleted = await delete_edge(
        memory_client._graphiti, memory_client.project_id, edge["uuid"]
    )
    assert deleted == 1
    assert await _edge_count(memory_client) == 0


@pytest.mark.asyncio
async def test_merge_nodes(memory_client):
    # Seed src, dst, plus two edges from src → X and Y → src to verify both
    # directions get re-pointed at dst.
    await _seed_nodes(
        memory_client,
        [
            {"uuid": "src", "name": "静儿", "label": "Character"},
            {"uuid": "dst", "name": "李静", "label": "Character"},
            {"uuid": "x", "name": "X", "label": "Entity"},
            {"uuid": "y", "name": "Y", "label": "Entity"},
        ],
    )
    await add_edge(memory_client._graphiti, memory_client.project_id,
                   "src", "x", name="认识")
    await add_edge(memory_client._graphiti, memory_client.project_id,
                   "y", "src", name="认识")

    result = await merge_nodes(
        memory_client._graphiti, memory_client.project_id, "src", "dst"
    )
    assert result["uuid"] == "dst"
    # Src is gone.
    assert await _count_nodes(memory_client, "静儿") == 0
    # Both edges must now attach to dst.
    async with memory_client._graphiti.driver.session() as sess:
        out = await sess.run(
            "MATCH (:_ {group_id: $gid, uuid: 'dst'})-[r]->(:_ {group_id: $gid, uuid: 'x'}) "
            "RETURN count(r) AS c".replace(":_", ""),
            gid=memory_client.project_id,
        )
        out_row = await out.single()
        incoming = await sess.run(
            "MATCH (:_ {group_id: $gid, uuid: 'y'})-[r]->(:_ {group_id: $gid, uuid: 'dst'}) "
            "RETURN count(r) AS c".replace(":_", ""),
            gid=memory_client.project_id,
        )
        in_row = await incoming.single()
    assert out_row["c"] == 1
    assert in_row["c"] == 1


@pytest.mark.asyncio
async def test_merge_refuses_self(memory_client):
    with pytest.raises(EditError, match="into itself"):
        await merge_nodes(
            memory_client._graphiti, memory_client.project_id, "x", "x"
        )
