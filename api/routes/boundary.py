"""Cognitive-boundary snapshot endpoint.

The Boundary page needs a per-character × per-beat knowledge matrix plus
"latest revelation" per character. Computing this client-side requires
N_chars × N_beats round trips to ``POST /query`` — slow and chatty. This
endpoint does it server-side in one call.

Performance-critical path: we fetch each character's hybrid-search edge
list *once* and then filter per-beat in Python. The naive N_chars ×
N_beats call into ``query_character_knowledge`` multiplies the expensive
bits (embedding + LLM rerank) by the beat count; with ~6 chars × ~6
beats that's ~36 rerank calls, which on OpenRouter-hosted Qwen routinely
took >5 minutes and looked to the browser like a timeout. See the
``_character_edges`` helper below — it runs the search exactly once per
character.

Returns a single JSON object the frontend can feed straight into the
matrix UI:

```
{
  "characters": [{"uuid", "name"}],
  "beats":      [{"uuid", "label", "type", "tension", "episode",
                  "scene_end_ep", "scene_end_sc"}],
  "facts":      [str, ...]            # union across all (char, beat) pairs
  "knowledge":  {char_uuid: {beat_uuid: [fact_str, ...]}}
  "latest":     {char_uuid: {"fact": str, "beat_uuid": str} | null}
}
```
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api.deps import ClientCache, get_cache, get_client
from screenplay_memory.queries.cognitive import _is_within_cutoff

router = APIRouter(prefix="/projects/{project_id}/boundary", tags=["boundary"])
logger = logging.getLogger(__name__)

# Must match the constants inside client.py — the Boundary page is
# showing cognition *at* a beat, and beats live in the HL group_id
# whose reference_time was stamped per scene end. Recomputing the
# cutoff here keeps this endpoint decoupled from MemoryClient internals.
_BASE_EPOCH = datetime(2020, 1, 1, tzinfo=timezone.utc)

# Upper bound on edges fetched per character. Generous for POC scripts;
# log a warning if we ever hit it so we know to raise.
_PER_CHARACTER_EDGE_CAP = 200


def _cutoff(ep: int, sc: int) -> datetime:
    # Same formula as _scene_reference_time in client.py, applied to the
    # scene immediately after the beat's range end so edges created at
    # that scene are included.
    return _BASE_EPOCH + timedelta(seconds=ep * 10000 + (sc + 1) * 100)


_CHINESE_SCENE_RE = re.compile(r"第(\d+)集第(\d+)场")


def _parse_scene_ref(ref: str | None) -> tuple[int, int] | None:
    if not ref:
        return None
    ref = ref.strip()
    parts = ref.split("-")
    if len(parts) == 2:
        try:
            ep, sc = int(parts[0]), int(parts[1])
            if ep >= 0 and sc >= 0:
                return ep, sc
        except ValueError:
            pass
    m = _CHINESE_SCENE_RE.search(ref)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


async def _character_edges(graphiti: Any, project_id: str, character_name: str) -> list[Any]:
    """Run the cognitive-boundary hybrid search exactly once per character.

    The query string mirrors ``query_character_knowledge`` so the
    ranking semantics stay identical to the single-scene ``/query``
    endpoint. The result is filtered by beat cutoff in memory instead of
    re-searching per beat.
    """
    edges = await graphiti.search(
        query=f"{character_name} 知道的事情和遇到的人",
        group_ids=[project_id],
        num_results=_PER_CHARACTER_EDGE_CAP,
    )
    if len(edges) >= _PER_CHARACTER_EDGE_CAP:
        logger.warning(
            "boundary: %s hit edge cap (%d); some edges may be dropped. "
            "Bump _PER_CHARACTER_EDGE_CAP if this persists.",
            character_name,
            _PER_CHARACTER_EDGE_CAP,
        )
    return edges


@router.get("")
async def get_boundary(
    project_id: str, cache: ClientCache = Depends(get_cache)
) -> dict[str, Any]:
    client = await get_client(project_id, cache)
    graphiti = client._graphiti

    detail_gid = project_id
    hl_gid = f"{project_id}__hl"

    # Step 1: fetch characters (detail layer)
    async with graphiti.driver.session() as sess:
        char_rows = await sess.run(
            """
            MATCH (n) WHERE n.group_id = $gid
              AND n.name IS NOT NULL
              AND 'Character' IN labels(n)
            RETURN n.uuid AS uuid, n.name AS name
            ORDER BY n.name
            """,
            gid=detail_gid,
        )
        characters = [dict(r) async for r in char_rows]

    # Step 2: fetch beats (HL layer); order by episode then scene_end
    async with graphiti.driver.session() as sess:
        beat_rows = await sess.run(
            """
            MATCH (n) WHERE n.group_id = $gid
              AND n.beat_type IS NOT NULL
            RETURN n.uuid AS uuid,
                   n.name  AS label,
                   n.beat_type AS beat_type,
                   n.tension_level AS tension,
                   n.scene_range_end AS range_end
            """,
            gid=hl_gid,
        )
        raw = [dict(r) async for r in beat_rows]

    beats = []
    for b in raw:
        parsed = _parse_scene_ref(b.get("range_end"))
        if parsed is None:
            continue
        ep, sc = parsed
        beats.append(
            {
                "uuid": b["uuid"],
                "label": b.get("label") or "节拍",
                "type": b.get("beat_type") or "",
                "tension": int(b.get("tension") or 3),
                "episode": ep,
                "scene_end_ep": ep,
                "scene_end_sc": sc,
            }
        )
    beats.sort(key=lambda x: (x["episode"], x["scene_end_sc"]))

    if not characters:
        raise HTTPException(404, "no Character nodes — ingest a script first")
    if not beats:
        # Fallback: use Scene nodes from the detail layer as the timeline.
        # The HL layer is optional in the bazong_demo workflow — it's a
        # separate ``ingest_hl`` pass — but every detail-layer ingest
        # creates a Scene per episode/scene pair via the synthesised
        # SCENE_HEADER_TEMPLATE. Treat each Scene like a synthetic beat
        # so the matrix can still render. ``tension`` defaults to 3 and
        # ``type`` is empty; the frontend already tolerates both.
        async with graphiti.driver.session() as sess:
            scene_rows = await sess.run(
                """
                MATCH (n) WHERE n.group_id = $gid
                  AND 'Scene' IN labels(n)
                  AND n.episode_number IS NOT NULL
                  AND n.scene_number IS NOT NULL
                RETURN n.uuid AS uuid,
                       coalesce(n.name, '') AS label,
                       n.episode_number AS ep,
                       n.scene_number   AS sc
                """,
                gid=detail_gid,
            )
            scene_raw = [dict(r) async for r in scene_rows]
        for s in scene_raw:
            ep = int(s.get("ep") or 0)
            sc = int(s.get("sc") or 0)
            beats.append(
                {
                    "uuid": s["uuid"],
                    "label": s.get("label") or f"第{ep}集第{sc}场",
                    "type": "Scene",
                    "tension": 3,
                    "episode": ep,
                    "scene_end_ep": ep,
                    "scene_end_sc": sc,
                }
            )
        beats.sort(key=lambda x: (x["episode"], x["scene_end_sc"]))
    if not beats:
        raise HTTPException(
            404,
            "no Beat or Scene nodes — ingest a script first",
        )

    # Step 3: per-character search (O(N)), then filter by cutoff per beat.
    # Previously this was O(N × M) with a graphiti.search per (char, beat)
    # pair — that hit LLM rerank once per pair and took minutes.
    knowledge: dict[str, dict[str, list[str]]] = {}
    latest: dict[str, dict[str, str] | None] = {}
    fact_union: set[str] = set()

    for c in characters:
        char_name = c["name"]
        knowledge[c["uuid"]] = {}
        latest[c["uuid"]] = None

        try:
            edges = await _character_edges(graphiti, project_id, char_name)
        except Exception as exc:
            # One character's search failure shouldn't nuke the matrix.
            logger.warning("boundary: search failed for %s: %s", char_name, exc)
            for b in beats:
                knowledge[c["uuid"]][b["uuid"]] = []
            continue

        # Pre-filter edges to this character's witness scope once; the
        # ``witness_scope`` check doesn't depend on the beat cutoff.
        my_edges = []
        for e in edges:
            fact = getattr(e, "fact", None) or ""
            if not fact:
                continue
            witness = (getattr(e, "attributes", None) or {}).get("witness_scope") or []
            if char_name not in witness:
                continue
            my_edges.append((e, fact))

        last_known: set[str] = set()
        for b in beats:
            cutoff = _cutoff(b["scene_end_ep"], b["scene_end_sc"])
            facts = [
                fact
                for (e, fact) in my_edges
                if _is_within_cutoff(e, cutoff)
            ]
            knowledge[c["uuid"]][b["uuid"]] = facts
            fact_union.update(facts)

            new_facts = [f for f in facts if f not in last_known]
            if new_facts:
                latest[c["uuid"]] = {"fact": new_facts[-1], "beat_uuid": b["uuid"]}
            last_known = set(facts)

    return {
        "characters": characters,
        "beats": beats,
        "facts": sorted(fact_union)[:12],  # cap column count for readability
        "knowledge": knowledge,
        "latest": latest,
    }
