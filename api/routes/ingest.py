"""Ingest endpoint — streams SSE progress events per scene.

The caller POSTs a structured ``segmentation`` (list of scenes). We run
the detail pass one scene at a time, emitting ``scene_ingested`` events,
then optionally the HL pass once, then a final ``done`` event.
"""

from __future__ import annotations

from typing import AsyncIterator

from fastapi import APIRouter, Depends

from api.deps import ClientCache, get_cache, get_client
from api.models import IngestRequest
from api.sse import json_sse
from screenplay_memory.annotations_hl import attach_beats_to_scenes

router = APIRouter(prefix="/projects/{project_id}/ingest", tags=["ingest"])


@router.post("")
async def ingest(
    project_id: str,
    body: IngestRequest,
    cache: ClientCache = Depends(get_cache),
):
    client = await get_client(project_id, cache)
    scenes = body.segmentation
    run_hl = body.run_hl

    async def stream() -> AsyncIterator[dict]:
        yield {"event": "segment", "data": {"count": len(scenes)}}

        for s in scenes:
            try:
                result = await client.ingest(s.body, s.episode, s.scene)
            except Exception as e:
                yield {
                    "event": "error",
                    "data": {
                        "phase": "detail",
                        "episode": s.episode,
                        "scene": s.scene,
                        "message": str(e),
                    },
                }
                return
            yield {
                "event": "scene_ingested",
                "data": {
                    "episode": s.episode,
                    "scene": s.scene,
                    "entities_created": result["entities_created"],
                    "facts_created": result["facts_created"],
                },
            }

        if run_hl:
            yield {"event": "hl_started", "data": {}}
            try:
                hl_result = await client.ingest_hl(
                    [(s.episode, s.scene, s.body) for s in scenes]
                )
                bridge = await attach_beats_to_scenes(
                    client._graphiti, client.project_id
                )
            except Exception as e:
                yield {"event": "error", "data": {"phase": "hl", "message": str(e)}}
                return
            yield {
                "event": "hl_done",
                "data": {
                    "entities_created": hl_result["entities_created"],
                    "covers_edges_created": bridge["covers_edges_created"],
                    "beats_total": bridge["beats_total"],
                },
            }

        yield {"event": "done", "data": {}}

    return json_sse(stream())
