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
import re
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException

from api.deps import ClientCache, get_cache, get_client
from api.models import IngestRequest
from api.sse import json_sse
from screenplay_memory.annotations_hl import attach_beats_to_scenes

router = APIRouter(prefix="/projects/{project_id}/ingest", tags=["ingest"])

_MAX_CONCURRENT = 2

# --- Demo source-scene preview --------------------------------------------
#
# Tab 03 of the web UI shows a read-only preview of the original script
# files so a viewer can see "this is the source script" alongside the
# graph. Files live on the backend filesystem (tests/seed_data/scenes)
# and are only exposed for the bazong_demo project — other projects do
# not have these files.
_SCENES_DIR = Path(__file__).resolve().parents[2] / "tests" / "seed_data" / "scenes"
_SCENE_FILENAME_RE = re.compile(r"^ep(\d+)_sc(\d+)\.txt$")
_SCENE_CONTENT_CAP = 2000  # characters per scene; long enough for any seed file
_SOURCE_SCENES_PROJECT = "bazong_demo"


@router.get("/source-scenes")
async def source_scenes(project_id: str) -> dict:
    """Return read-only seed script for the demo project.

    Globs ``tests/seed_data/scenes/ep*_sc*.txt``, parses episode/scene
    from the filename and returns the raw text (capped to
    ``_SCENE_CONTENT_CAP`` characters per scene). Restricted to the
    bazong_demo project for now.
    """
    if project_id != _SOURCE_SCENES_PROJECT:
        raise HTTPException(
            status_code=404,
            detail=f"source-scenes is only available for project '{_SOURCE_SCENES_PROJECT}'",
        )
    if not _SCENES_DIR.is_dir():
        raise HTTPException(status_code=404, detail="seed_data/scenes directory missing")

    scenes: list[dict] = []
    for path in sorted(_SCENES_DIR.glob("ep*_sc*.txt")):
        m = _SCENE_FILENAME_RE.match(path.name)
        if not m:
            continue
        ep = int(m.group(1))
        sc = int(m.group(2))
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if len(content) > _SCENE_CONTENT_CAP:
            content = content[:_SCENE_CONTENT_CAP] + "…"
        scenes.append({
            "episode_number": ep,
            "scene_number": sc,
            "content": content,
        })
    return {"scenes": scenes}


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
