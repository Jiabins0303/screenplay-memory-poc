"""Cognitive boundary query — what does character X know at scene N?

MVP strategy (per PRD §6.5): use Graphiti's hybrid `search` first and filter
the returned `EntityEdge`s by character relevance and `valid_at` cutoff. If
results are insufficient, fall back to direct Cypher (only after reporting
the gap to the user — do not silently bypass).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


async def query_character_knowledge(
    graphiti: Any,
    project_id: str,
    character_name: str,
    at_scene_episode: int,
    at_scene_number: int,
    cutoff: datetime,
) -> dict:
    """Return what `character_name` knows at the start of (episode, scene).

    Args:
        graphiti: live Graphiti instance (we use `.search` and `.driver`).
        project_id: group_id namespace.
        character_name: 角色名 (already normalized — no aliases yet).
        at_scene_episode: episode number for context (returned in payload).
        at_scene_number: scene number for context (returned in payload).
        cutoff: datetime threshold; only edges with `valid_at < cutoff` and
            `(invalid_at is None or invalid_at > cutoff)` are kept. Computed
            by the caller via `_scene_reference_time(episode, scene + 1)` so
            the query covers everything that happened *up to and including*
            the target scene.

    Returns:
        Structured dict per PRD §6.5.
    """
    edges = await graphiti.search(
        query=f"{character_name} 知道的事情和遇到的人",
        group_ids=[project_id],
        num_results=20,
    )

    knows_facts: list[str] = []
    knows_characters: set[str] = set()
    witnessed_events: list[dict] = []

    for e in edges:
        if not _is_within_cutoff(e, cutoff):
            continue
        fact = getattr(e, "fact", None) or ""
        witness = (getattr(e, "attributes", None) or {}).get("witness_scope") or []
        if character_name not in witness:
            continue

        knows_facts.append(fact)

        # Resolve the other endpoint of the edge → known characters
        other = await _resolve_other_character(
            graphiti, e, character_name, project_id
        )
        if other:
            knows_characters.add(other)

        # Witnessed/参与 events go in their own bucket for richer payloads
        rel_name = (getattr(e, "name", "") or "").lower()
        if any(k in rel_name for k in ("witness", "目睹", "参与", "见证")):
            witnessed_events.append({
                "fact": fact,
                "valid_at": _iso(getattr(e, "valid_at", None)),
            })

    return {
        "character": character_name,
        "at_scene": {
            "episode": at_scene_episode,
            "scene": at_scene_number,
        },
        "knows_facts": knows_facts,
        "knows_characters": sorted(knows_characters),
        "witnessed_events": witnessed_events,
        "query_metadata": {
            "cutoff": _iso(cutoff),
            "edges_scanned": len(edges),
            "edges_kept": len(knows_facts),
        },
    }


def _is_within_cutoff(edge: Any, cutoff: datetime) -> bool:
    """Keep edges that are valid at the cutoff timestamp."""
    valid_at = getattr(edge, "valid_at", None)
    invalid_at = getattr(edge, "invalid_at", None)

    # If Graphiti couldn't infer a time, we conservatively keep the edge
    # (the synthetic reference_time on the episode still gives ordering via
    # the episode itself, but valid_at on the edge may be null).
    if valid_at is not None and valid_at >= cutoff:
        return False
    if invalid_at is not None and invalid_at <= cutoff:
        return False
    return True


async def _resolve_other_character(
    graphiti: Any,
    edge: Any,
    self_name: str,
    project_id: str,
) -> str | None:
    """Look up the non-self endpoint of `edge` and return its name if Character."""
    src_uuid = getattr(edge, "source_node_uuid", None)
    dst_uuid = getattr(edge, "target_node_uuid", None)
    if not (src_uuid and dst_uuid):
        return None

    async with graphiti.driver.session() as sess:
        result = await sess.run(
            "MATCH (n) WHERE n.uuid IN [$a, $b] AND n.group_id = $gid "
            "RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels",
            a=src_uuid,
            b=dst_uuid,
            gid=project_id,
        )
        rows = [dict(r) async for r in result]

    for row in rows:
        if row["name"] == self_name:
            continue
        if "Character" in (row.get("labels") or []):
            return row["name"]
    return None


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if isinstance(dt, datetime) else None
