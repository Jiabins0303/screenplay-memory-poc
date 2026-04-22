"""Ontology spec GET / PUT — called pre-ingest so the UI can customise schema."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.deps import ClientCache, get_cache, get_client
from api.models import Layer, OntologySpec
from screenplay_memory.ontology_customization import (
    OntologySpecError,
    default_spec_detail,
    load_spec,
    save_spec,
)

router = APIRouter(prefix="/projects/{project_id}/ontology", tags=["ontology"])


@router.get("")
async def get_ontology(
    project_id: str,
    layer: Layer = "detail",
    cache: ClientCache = Depends(get_cache),
) -> dict:
    client = await get_client(project_id, cache)
    saved = await load_spec(client._graphiti, project_id, layer)
    if saved is not None:
        return {"source": "saved", "layer": layer, "spec": saved}
    if layer == "detail":
        return {"source": "default", "layer": layer, "spec": default_spec_detail()}
    # HL default (dump built-in HL types). Reuse default_spec_detail's
    # dumper by passing the HL types.
    from screenplay_memory.ontology_customization import _dump_model
    from screenplay_memory.ontology_hl import HL_EDGE_TYPES, HL_ENTITY_TYPES
    return {
        "source": "default",
        "layer": layer,
        "spec": {
            "entities": [_dump_model(cls) for cls in HL_ENTITY_TYPES.values()],
            "edges": [_dump_model(cls) for cls in HL_EDGE_TYPES.values()],
        },
    }


@router.put("")
async def put_ontology(
    project_id: str,
    body: OntologySpec,
    layer: Layer = "detail",
    cache: ClientCache = Depends(get_cache),
) -> dict:
    client = await get_client(project_id, cache)
    # Guard against overwriting schema after ingest: if this group already
    # has entities, reject. Graph is live — schema changes would orphan
    # fields. The user must clear first.
    gid = project_id if layer == "detail" else f"{project_id}__hl"
    async with client._graphiti.driver.session() as sess:
        result = await sess.run(
            "MATCH (n) WHERE n.group_id = $gid RETURN count(n) AS c",
            gid=gid,
        )
        row = await result.single()
    if row and row["c"] > 0:
        raise HTTPException(
            409, f"layer '{layer}' already has {row['c']} nodes; clear before editing schema"
        )

    try:
        await save_spec(client._graphiti, project_id, layer, body.model_dump())
    except OntologySpecError as e:
        raise HTTPException(400, str(e)) from e

    # Drop the cached client so the next ingest picks up the new spec on
    # its next _ensure_init(). Simpler than surgically patching state.
    await cache.evict(project_id)
    return {"status": "saved", "layer": layer}
