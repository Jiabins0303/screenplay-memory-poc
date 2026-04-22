"""Post-ingest editing endpoints — thin adapter over src/screenplay_memory/edits.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.deps import ClientCache, get_cache, get_client
from api.models import AddEdgeRequest, MergeNodesRequest, UpdateNodeRequest
from screenplay_memory.edits import (
    EditError,
    add_edge,
    delete_edge,
    delete_node,
    merge_nodes,
    rename_node,
    update_node_props,
)

router = APIRouter(prefix="/projects/{project_id}", tags=["edits"])


@router.patch("/nodes/{node_uuid}")
async def patch_node(
    project_id: str,
    node_uuid: str,
    body: UpdateNodeRequest,
    cache: ClientCache = Depends(get_cache),
) -> dict:
    client = await get_client(project_id, cache)
    try:
        result: dict = {}
        if body.name is not None:
            result.update(
                await rename_node(client._graphiti, project_id, node_uuid, body.name)
            )
        if body.properties:
            result.update(
                await update_node_props(
                    client._graphiti, project_id, node_uuid, body.properties
                )
            )
    except EditError as e:
        raise HTTPException(404, str(e)) from e
    return result


@router.delete("/nodes/{node_uuid}")
async def delete_node_endpoint(
    project_id: str, node_uuid: str, cache: ClientCache = Depends(get_cache)
) -> dict:
    client = await get_client(project_id, cache)
    try:
        deleted = await delete_node(client._graphiti, project_id, node_uuid)
    except EditError as e:
        raise HTTPException(404, str(e)) from e
    return {"deleted": deleted}


@router.post("/nodes/merge")
async def merge_nodes_endpoint(
    project_id: str, body: MergeNodesRequest, cache: ClientCache = Depends(get_cache)
) -> dict:
    client = await get_client(project_id, cache)
    try:
        return await merge_nodes(
            client._graphiti, project_id, body.src_uuid, body.dst_uuid
        )
    except EditError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/edges")
async def add_edge_endpoint(
    project_id: str, body: AddEdgeRequest, cache: ClientCache = Depends(get_cache)
) -> dict:
    client = await get_client(project_id, cache)
    try:
        return await add_edge(
            client._graphiti,
            project_id,
            body.source_uuid,
            body.target_uuid,
            name=body.name,
            fact=body.fact,
        )
    except EditError as e:
        raise HTTPException(400, str(e)) from e


@router.delete("/edges/{edge_uuid}")
async def delete_edge_endpoint(
    project_id: str, edge_uuid: str, cache: ClientCache = Depends(get_cache)
) -> dict:
    client = await get_client(project_id, cache)
    try:
        deleted = await delete_edge(client._graphiti, project_id, edge_uuid)
    except EditError as e:
        raise HTTPException(404, str(e)) from e
    return {"deleted": deleted}
