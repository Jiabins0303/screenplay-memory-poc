"""Build inverse index from entities/edges back to source Scenes.

Graphiti stores `episodes: list[str]` on each EntityNode and EntityEdge —
the list of Episodic UUIDs the item was extracted from. We call
`add_episode` once per scene, so an Episodic node corresponds 1:1 to a
Scene we extracted. This module:

  1. Builds Episodic → Scene `:OF_SCENE` edges by matching on
     (episode_num, scene_num) properties (set on Episodic by client.py
     via reference_time decoding) against (episode, scene_number) on the
     extracted Scene entity.
  2. Writes `scene_appearances: list[str]` (Scene UUIDs) onto every
     non-Scene, non-Episodic node within a group_id.
  3. Writes `scene_appearances: list[str]` onto every edge that has a
     non-empty `episodes` list.
  4. Writes `quotes: list[str]` onto edges (JSON-serialized list of
     {scene_uuid, snippet} dicts), grabbing ±50 chars around the source/
     target node names from each Episodic's content. Capped at 3 quotes/edge.

After ingest, call `build_scene_index(driver, group_id=...)` once.
Idempotent — safe to call multiple times.
"""
from __future__ import annotations

import json
from typing import Any

from neo4j import AsyncDriver


async def build_scene_index(driver: AsyncDriver, group_id: str) -> dict[str, int]:
    """Run all 4 index passes for a project. Returns counts for telemetry."""
    counts: dict[str, int] = {}
    async with driver.session() as sess:
        counts["of_scene_edges"] = await _link_episodic_to_scene(sess, group_id)
        counts["nodes_indexed"] = await _index_node_appearances(sess, group_id)
        counts["edges_indexed"] = await _index_edge_appearances(sess, group_id)
        counts["edge_quotes_written"] = await _write_edge_quotes(sess, group_id)
    return counts


async def _link_episodic_to_scene(sess, gid: str) -> int:
    """Build (Episodic)-[:OF_SCENE]->(Scene) edges."""
    result = await sess.run(
        """
        MATCH (e:Episodic) WHERE e.group_id=$gid
        MATCH (s:Scene) WHERE s.group_id=$gid
            AND s.episode_number = e.episode_num
            AND s.scene_number = e.scene_num
        MERGE (e)-[r:OF_SCENE]->(s)
        RETURN count(r) AS n
        """,
        gid=gid,
    )
    rec = await result.single()
    return rec["n"] if rec else 0


async def _index_node_appearances(sess, gid: str) -> int:
    result = await sess.run(
        """
        MATCH (n) WHERE n.group_id=$gid
            AND NOT 'Scene' IN labels(n)
            AND NOT 'Episodic' IN labels(n)
            AND n.episodes IS NOT NULL
        OPTIONAL MATCH (e:Episodic)-[:OF_SCENE]->(s:Scene)
            WHERE e.uuid IN n.episodes
        WITH n, collect(DISTINCT s.uuid) AS sids
        SET n.scene_appearances = sids
        RETURN count(n) AS n
        """,
        gid=gid,
    )
    rec = await result.single()
    return rec["n"] if rec else 0


async def _index_edge_appearances(sess, gid: str) -> int:
    result = await sess.run(
        """
        MATCH (a)-[r]->(b) WHERE r.group_id=$gid
            AND r.episodes IS NOT NULL
        OPTIONAL MATCH (e:Episodic)-[:OF_SCENE]->(s:Scene)
            WHERE e.uuid IN r.episodes
        WITH r, collect(DISTINCT s.uuid) AS sids
        SET r.scene_appearances = sids
        RETURN count(r) AS n
        """,
        gid=gid,
    )
    rec = await result.single()
    return rec["n"] if rec else 0


async def _write_edge_quotes(sess, gid: str) -> int:
    """Pull source-text snippets ±50 chars around source/target names per edge."""
    result = await sess.run(
        """
        MATCH (a)-[r]->(b) WHERE r.group_id=$gid
            AND r.episodes IS NOT NULL
        WITH a, b, r, r.episodes[0..3] AS epis
        UNWIND epis AS eu
        MATCH (e:Episodic {uuid:eu})-[:OF_SCENE]->(s:Scene)
        RETURN r.uuid AS rid, a.name AS aname, b.name AS bname,
               s.uuid AS sid, e.content AS content
        """,
        gid=gid,
    )
    by_edge: dict[str, list[dict[str, Any]]] = {}
    async for row in result:
        rid = row["rid"]
        if not rid or not row["content"]:
            continue
        snippet = _extract_around(row["content"], row["aname"], row["bname"])
        if snippet:
            by_edge.setdefault(rid, []).append({"scene_uuid": row["sid"], "snippet": snippet})

    n_written = 0
    for rid, quotes in by_edge.items():
        await sess.run(
            "MATCH ()-[r {uuid:$rid}]->() SET r.quotes = $q",
            rid=rid,
            q=json.dumps(quotes[:3], ensure_ascii=False),
        )
        n_written += 1
    return n_written


def _extract_around(content: str, *names: str | None) -> str:
    """Return ±50-char snippet around the first name found; '' if none found."""
    for name in names:
        if not name:
            continue
        idx = content.find(name)
        if idx >= 0:
            start = max(0, idx - 50)
            end = min(len(content), idx + len(name) + 50)
            snippet = content[start:end].replace("\n", " ").strip()
            return snippet
    return ""
