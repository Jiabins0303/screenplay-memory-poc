"""Chat / query endpoint.

Two modes:
  * ``cognitive`` — character knowledge at a given scene cutoff. Wraps
    ``MemoryClient.query_cognitive``.
  * ``search`` — free-form hybrid search over both layers via
    ``graphiti.search``. The result is a flat list of edge facts.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.deps import ClientCache, get_cache, get_client
from api.models import QueryRequest

router = APIRouter(prefix="/projects/{project_id}/query", tags=["query"])


@router.post("")
async def query(
    project_id: str,
    body: QueryRequest,
    cache: ClientCache = Depends(get_cache),
) -> dict:
    client = await get_client(project_id, cache)

    if body.mode == "cognitive":
        if not body.character:
            raise HTTPException(400, "cognitive mode requires 'character'")
        if body.at_scene_episode is None or body.at_scene_number is None:
            raise HTTPException(
                400,
                "cognitive mode requires 'at_scene_episode' and 'at_scene_number'",
            )
        result = await client.query_cognitive(
            body.character,
            at_scene_episode=body.at_scene_episode,
            at_scene_number=body.at_scene_number,
        )
        # query_cognitive returns sets in knows_characters; convert for JSON.
        if isinstance(result.get("knows_characters"), set):
            result["knows_characters"] = sorted(result["knows_characters"])
        return {"mode": "cognitive", "result": result}

    # search mode
    if not body.question.strip():
        raise HTTPException(400, "search mode requires 'question'")
    results = await client._graphiti.search(
        query=body.question,
        group_ids=[project_id, f"{project_id}__hl"],
        num_results=20,
    )
    facts = []
    for edge in results:
        facts.append(
            {
                "uuid": getattr(edge, "uuid", None),
                "fact": getattr(edge, "fact", None) or getattr(edge, "name", ""),
                "valid_at": _iso(getattr(edge, "valid_at", None)),
                "source_node_uuid": getattr(edge, "source_node_uuid", None),
                "target_node_uuid": getattr(edge, "target_node_uuid", None),
            }
        )
    return {"mode": "search", "results": facts}


def _iso(v):
    if not v:
        return None
    try:
        return v.isoformat()
    except (AttributeError, TypeError):
        # Driver-side coercion can return strings or other shapes that
        # don't expose isoformat(); fall back to None so JSON encoding
        # still succeeds.
        return None
