"""Bridge the HL beat layer to the detail scene layer.

A Beat carries ``scene_range_start`` / ``scene_range_end`` strings (e.g.
``"1-2"`` → episode 1, scene 2). After both layers are ingested, this
module walks every Beat in ``group_id=f"{project_id}__hl"`` and creates
``(:Beat)-[:COVERS]->(:Scene)`` edges to the detail-layer ``Scene`` nodes
that fall inside the Beat's range. Pure deterministic Cypher — no LLM.

The edge itself carries ``group_id = "bridge"`` so it is easy to filter
out in single-layer queries.
"""

from __future__ import annotations

from typing import Any

from screenplay_memory.scene_ref import parse_scene_ref


async def attach_beats_to_scenes(graphiti: Any, project_id: str) -> dict:
    """Create ``(:Beat)-[:COVERS]->(:Scene)`` edges.

    Returns a debug dict so callers can log how many beats were linked and
    how many cross-layer edges landed — the ratio flags prompt-quality
    regressions where Beats report scene ranges the detail layer doesn't
    contain.
    """
    hl_gid = f"{project_id}__hl"
    detail_gid = project_id

    async with graphiti.driver.session() as sess:
        result = await sess.run(
            """
            MATCH (b) WHERE b.group_id = $hl_gid AND b.beat_type IS NOT NULL
            RETURN b.uuid AS uuid,
                   b.scene_range_start AS start,
                   b.scene_range_end AS end
            """,
            hl_gid=hl_gid,
        )
        beats = [dict(r) async for r in result]

    edges_created = 0
    beats_with_range = 0
    for beat in beats:
        start = parse_scene_ref(beat.get("start"))
        end = parse_scene_ref(beat.get("end")) or start
        if start is None:
            continue
        if end is None:
            end = start
        beats_with_range += 1
        ep_s, sc_s = start
        ep_e, sc_e = end

        async with graphiti.driver.session() as sess:
            result = await sess.run(
                """
                MATCH (s) WHERE s.group_id = $detail_gid
                  AND s.episode_number IS NOT NULL
                  AND s.scene_number IS NOT NULL
                  AND (
                      (
                        $ep_s = $ep_e
                        AND s.episode_number = $ep_s
                        AND s.scene_number >= $sc_s
                        AND s.scene_number <= $sc_e
                      )
                      OR (
                        $ep_s < $ep_e
                        AND (
                          (s.episode_number = $ep_s AND s.scene_number >= $sc_s)
                          OR
                          (s.episode_number = $ep_e AND s.scene_number <= $sc_e)
                          OR
                          (s.episode_number > $ep_s AND s.episode_number < $ep_e)
                        )
                      )
                  )
                WITH s
                MATCH (b {uuid: $beat_uuid, group_id: $hl_gid})
                MERGE (b)-[r:COVERS {beat_uuid: $beat_uuid, scene_uuid: s.uuid}]->(s)
                ON CREATE SET r.group_id = 'bridge'
                RETURN count(r) AS c
                """,
                detail_gid=detail_gid,
                hl_gid=hl_gid,
                beat_uuid=beat["uuid"],
                ep_s=ep_s, sc_s=sc_s, ep_e=ep_e, sc_e=sc_e,
            )
            row = await result.single()
            edges_created += (row["c"] if row else 0)

    return {
        "beats_total": len(beats),
        "beats_with_range": beats_with_range,
        "covers_edges_created": edges_created,
    }
