"""Phase 2 tests — high-level "beat" layer ingest + scene bridge.

Keeps the LLM-hitting portion minimal (one full-script HL extraction)
while unit-testing the deterministic pieces (parsing, doc assembly)
without any network calls.
"""

from __future__ import annotations

import pytest

from screenplay_memory.annotations_hl import _parse_scene_ref, attach_beats_to_scenes
from screenplay_memory.chinese.prompts_hl import (
    HL_SCENE_HEADER_TEMPLATE,
    build_hl_document,
)
from tests.conftest import read_file


# --- Pure unit tests --------------------------------------------------------


def test_parse_scene_ref_valid():
    assert _parse_scene_ref("1-2") == (1, 2)
    assert _parse_scene_ref("  3-10 ") == (3, 10)


def test_parse_scene_ref_invalid():
    assert _parse_scene_ref("") is None
    assert _parse_scene_ref(None) is None
    assert _parse_scene_ref("abc") is None
    assert _parse_scene_ref("1") is None
    assert _parse_scene_ref("1-2-3") is None
    assert _parse_scene_ref("-1-2") is None


def test_build_hl_document():
    scenes = [(1, 1, "第一场内容"), (1, 2, "第二场内容")]
    doc = build_hl_document(scenes)
    assert HL_SCENE_HEADER_TEMPLATE.format(episode=1, scene=1) in doc
    assert HL_SCENE_HEADER_TEMPLATE.format(episode=1, scene=2) in doc
    assert "第一场内容" in doc
    assert "第二场内容" in doc


# --- Integration tests (LLM + Neo4j) ---------------------------------------


@pytest.mark.asyncio
async def test_ingest_hl_extracts_beats(memory_client):
    """Feed 3 scenes through HL extraction; expect at least one Beat.

    Qwen beat recall on short scripts is brittle — we assert the floor,
    not the full 6-beat skeleton. Prompt iteration can raise the bar later.
    """
    scenes = [
        (1, 1, read_file("scene_01.txt")),
        (1, 2, read_file("scene_02.txt")),
        (1, 3, read_file("scene_03.txt")),
    ]

    result = await memory_client.ingest_hl(scenes)
    assert result["status"] == "success"
    assert result["layer"] == "hl"
    assert result["entities_created"] >= 1, (
        f"HL extraction produced no entities: {result!r}"
    )

    beats = await memory_client.query_beats()
    assert len(beats) >= 1, f"no Beat nodes found: {beats!r}"
    # At least one beat should carry a meaningful beat_type.
    types = {b.get("beat_type") for b in beats if b.get("beat_type")}
    assert types, f"beats missing beat_type: {beats!r}"


@pytest.mark.asyncio
async def test_hl_lives_in_separate_group_id(memory_client):
    """HL nodes must not leak into the detail layer's group_id."""
    scenes = [(1, 1, read_file("scene_01.txt"))]
    await memory_client.ingest_hl(scenes)

    async with memory_client._graphiti.driver.session() as sess:
        # Detail layer must contain zero Beat-labelled nodes.
        result = await sess.run(
            """
            MATCH (n) WHERE n.group_id = $gid AND n.beat_type IS NOT NULL
            RETURN count(n) AS c
            """,
            gid=memory_client.project_id,
        )
        row = await result.single()
    assert row["c"] == 0, "HL beats leaked into detail group_id"


@pytest.mark.asyncio
async def test_bridge_runs_without_detail_scenes(memory_client):
    """If detail layer is empty, attach_beats_to_scenes must still succeed,
    just with zero edges created. Used when a user inspects beats before
    running detail ingest."""
    # Two scenes so Qwen reliably emits at least one Beat; a single scene
    # can produce zero beats legitimately (nothing to structure).
    scenes = [
        (1, 1, read_file("scene_01.txt")),
        (1, 2, read_file("scene_02.txt")),
    ]
    await memory_client.ingest_hl(scenes)

    report = await attach_beats_to_scenes(
        memory_client._graphiti, memory_client.project_id
    )
    # No detail Scene nodes → no COVERS edges, even if beats exist.
    assert report["covers_edges_created"] == 0
    # Bridge must always return a well-formed report, even with zero beats.
    assert "beats_total" in report
    assert "beats_with_range" in report
