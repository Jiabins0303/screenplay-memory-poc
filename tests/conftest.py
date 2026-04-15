"""Pytest fixtures and Cypher debug helpers for Stage 1+."""

from __future__ import annotations

import os

import pytest_asyncio

from screenplay_memory.client import MemoryClient


@pytest_asyncio.fixture
async def memory_client():
    """Provide a clean MemoryClient bound to project_id='test_project'."""
    client = MemoryClient(project_id="test_project")
    await client.clear()
    try:
        yield client
    finally:
        await client.clear()
        await client.close()


def read_file(filename: str) -> str:
    path = os.path.join(os.path.dirname(__file__), "seed_data", filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


async def get_all_entity_names(client: MemoryClient) -> list[str]:
    """Return every node name in this project's graph."""
    async with client._graphiti.driver.session() as sess:
        result = await sess.run(
            "MATCH (n) WHERE n.group_id = $gid AND n.name IS NOT NULL "
            "RETURN n.name AS name",
            gid=client.project_id,
        )
        return [r["name"] async for r in result]


async def get_nodes_by_label(client: MemoryClient, label: str) -> list[dict]:
    """Return nodes carrying the given label, scoped to this project."""
    async with client._graphiti.driver.session() as sess:
        result = await sess.run(
            f"MATCH (n:{label}) WHERE n.group_id = $gid RETURN n",
            gid=client.project_id,
        )
        return [dict(r["n"]) async for r in result]


async def get_edges_between(
    client: MemoryClient, source_name: str, target_name: str
) -> list[dict]:
    """Return edges going from source_name → target_name in this project."""
    async with client._graphiti.driver.session() as sess:
        result = await sess.run(
            "MATCH (a)-[r]->(b) "
            "WHERE a.group_id = $gid AND b.group_id = $gid "
            "AND a.name = $src AND b.name = $dst "
            "RETURN r",
            gid=client.project_id,
            src=source_name,
            dst=target_name,
        )
        return [dict(r["r"]) async for r in result]
