"""Verify the scene inverse index post-step writes scene_appearances/quotes
onto entity nodes and edges by setting up a minimal hand-built graph.

Pure Neo4j (no LLM); requires docker compose up -d.
"""
from __future__ import annotations

import pytest_asyncio
from neo4j import AsyncGraphDatabase

from screenplay_memory.config import Settings
from screenplay_memory.queries.scene_index import build_scene_index


@pytest_asyncio.fixture
async def driver():
    s = Settings.from_env()
    drv = AsyncGraphDatabase.driver(s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password))
    yield drv
    await drv.close()


@pytest_asyncio.fixture
async def fixture_graph(driver):
    """Build a tiny graph: 2 Episodic, 2 Scene, 1 Character, 1 edge."""
    gid = "test_scene_index"
    async with driver.session() as s:
        await s.run("MATCH (n) WHERE n.group_id=$gid DETACH DELETE n", gid=gid)
        await s.run(
            """
            CREATE (e1:Episodic {uuid:'e1', group_id:$gid, episode_num:1, scene_num:1})
            CREATE (e2:Episodic {uuid:'e2', group_id:$gid, episode_num:1, scene_num:2})
            CREATE (s1:Scene   {uuid:'s1', group_id:$gid, episode_number:1, scene_number:1, name:'第1集第1场'})
            CREATE (s2:Scene   {uuid:'s2', group_id:$gid, episode_number:1, scene_number:2, name:'第1集第2场'})
            CREATE (c1:Character {uuid:'c1', group_id:$gid, name:'苏念', episodes:['e1','e2']})
            CREATE (c2:Character {uuid:'c2', group_id:$gid, name:'厉北辰', episodes:['e1']})
            CREATE (c1)-[r:KNOWS {uuid:'r1', group_id:$gid, episodes:['e1']}]->(c2)
            """,
            gid=gid,
        )
    yield gid
    async with driver.session() as s:
        await s.run("MATCH (n) WHERE n.group_id=$gid DETACH DELETE n", gid=gid)


async def test_episodic_to_scene_link_built(driver, fixture_graph):
    await build_scene_index(driver, group_id=fixture_graph)
    async with driver.session() as s:
        r = await s.run(
            "MATCH (e:Episodic {uuid:'e1'})-[:OF_SCENE]->(s:Scene) "
            "WHERE e.group_id=$gid RETURN s.uuid AS sid",
            gid=fixture_graph,
        )
        record = await r.single()
        assert record is not None
        assert record["sid"] == "s1"


async def test_node_scene_appearances_written(driver, fixture_graph):
    await build_scene_index(driver, group_id=fixture_graph)
    async with driver.session() as s:
        r = await s.run(
            "MATCH (c:Character {uuid:'c1'}) WHERE c.group_id=$gid "
            "RETURN c.scene_appearances AS sa",
            gid=fixture_graph,
        )
        record = await r.single()
        sa = record["sa"]
        assert set(sa) == {"s1", "s2"}


async def test_edge_scene_appearances_written(driver, fixture_graph):
    await build_scene_index(driver, group_id=fixture_graph)
    async with driver.session() as s:
        r = await s.run(
            "MATCH (a)-[r:KNOWS {uuid:'r1'}]->(b) WHERE r.group_id=$gid "
            "RETURN r.scene_appearances AS sa",
            gid=fixture_graph,
        )
        record = await r.single()
        sa = record["sa"]
        assert set(sa) == {"s1"}


async def test_idempotent(driver, fixture_graph):
    """Running twice produces the same result (no duplicate OF_SCENE edges)."""
    await build_scene_index(driver, group_id=fixture_graph)
    await build_scene_index(driver, group_id=fixture_graph)
    async with driver.session() as s:
        r = await s.run(
            "MATCH (e:Episodic)-[r:OF_SCENE]->(s:Scene) "
            "WHERE e.group_id=$gid RETURN count(r) AS n",
            gid=fixture_graph,
        )
        record = await r.single()
        assert record["n"] == 2
