"""Project create / list / clear endpoints."""

from __future__ import annotations

import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException

from api.deps import ClientCache, any_driver, get_cache, get_client
from api.models import CreateProjectRequest, ProjectInfo

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=ProjectInfo)
async def create_project(
    body: CreateProjectRequest, cache: ClientCache = Depends(get_cache)
) -> ProjectInfo:
    pid = body.project_id or f"proj_{_uuid.uuid4().hex[:8]}"
    driver = await any_driver(cache)
    async with driver.session() as sess:
        result = await sess.run(
            """
            MERGE (p:Project {id: $pid})
            ON CREATE SET p.created_at = datetime()
            RETURN p.id AS id, toString(p.created_at) AS created_at
            """,
            pid=pid,
        )
        row = await result.single()
    if row is None:
        raise HTTPException(500, "failed to create project")
    # Warm the MemoryClient for subsequent requests.
    await cache.get(pid)
    return ProjectInfo(project_id=row["id"], created_at=row["created_at"])


@router.get("", response_model=list[ProjectInfo])
async def list_projects(cache: ClientCache = Depends(get_cache)) -> list[ProjectInfo]:
    driver = await any_driver(cache)
    async with driver.session() as sess:
        result = await sess.run(
            "MATCH (p:Project) RETURN p.id AS id, toString(p.created_at) AS created_at"
        )
        rows = [dict(r) async for r in result]
    return [ProjectInfo(project_id=r["id"], created_at=r["created_at"]) for r in rows]


@router.delete("/{project_id}")
async def clear_project(
    project_id: str, cache: ClientCache = Depends(get_cache)
) -> dict:
    """Wipe both layers + OntologyConfig + the Project sentinel for this pid."""
    client = await get_client(project_id, cache)
    await client.clear()
    driver = await any_driver(cache)
    async with driver.session() as sess:
        await sess.run("MATCH (p:Project {id: $pid}) DELETE p", pid=project_id)
    await cache.evict(project_id)
    return {"status": "cleared", "project_id": project_id}
