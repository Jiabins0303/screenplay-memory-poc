"""Ingest endpoint — streams SSE progress events per scene.

The caller POSTs a structured ``segmentation`` (list of scenes). We run
the detail pass with up to 2 concurrent scenes via asyncio.Semaphore,
emitting ``scene_ingested`` / ``scene_skipped`` events, then optionally
the HL pass once, then a final ``done`` event.

Scenes that were already ingested (Episodic node exists) are skipped
unless ``force=true``.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from fastapi import APIRouter, Depends

from api.deps import ClientCache, get_cache, get_client
from api.models import IngestRequest
from api.sse import json_sse
from screenplay_memory.annotations_hl import attach_beats_to_scenes

router = APIRouter(prefix="/projects/{project_id}/ingest", tags=["ingest"])

_MAX_CONCURRENT = 2


@router.post("")
async def ingest(
    project_id: str,
    body: IngestRequest,
    cache: ClientCache = Depends(get_cache),
):
    client = await get_client(project_id, cache)
    scenes = body.segmentation
    run_hl = body.run_hl
    force = body.force

    async def stream() -> AsyncIterator[dict]:
        yield {"event": "segment", "data": {"count": len(scenes)}}

        sem = asyncio.Semaphore(_MAX_CONCURRENT)
        queue: asyncio.Queue[dict] = asyncio.Queue()
        error_flag = asyncio.Event()

        async def process_scene(s):
            if error_flag.is_set():
                return
            async with sem:
                if error_flag.is_set():
                    return
                if not force and await client._is_scene_ingested(s.episode, s.scene):
                    await queue.put({
                        "event": "scene_skipped",
                        "data": {"episode": s.episode, "scene": s.scene},
                    })
                    return
                try:
                    result = await client.ingest(s.body, s.episode, s.scene)
                except Exception as e:
                    error_flag.set()
                    await queue.put({
                        "event": "error",
                        "data": {
                            "phase": "detail",
                            "episode": s.episode,
                            "scene": s.scene,
                            "message": str(e),
                        },
                    })
                    return
                await queue.put({
                    "event": "scene_ingested",
                    "data": {
                        "episode": s.episode,
                        "scene": s.scene,
                        "entities_created": result["entities_created"],
                        "facts_created": result["facts_created"],
                    },
                })

        tasks = [asyncio.create_task(process_scene(s)) for s in scenes]

        finished = 0
        total = len(scenes)
        while finished < total:
            ev = await queue.get()
            yield ev
            if ev["event"] == "error":
                for t in tasks:
                    t.cancel()
                return
            finished += 1

        await asyncio.gather(*tasks, return_exceptions=True)

        if run_hl:
            if not force and await client._is_hl_ingested():
                yield {"event": "hl_skipped", "data": {}}
            else:
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

        token_data = {}
        try:
            total = client._graphiti.token_tracker.get_total_usage()
            token_data = {
                "input_tokens": total.input_tokens,
                "output_tokens": total.output_tokens,
            }
            client._graphiti.token_tracker.reset()
        except Exception:
            pass
        yield {"event": "done", "data": token_data}

    return json_sse(stream())
