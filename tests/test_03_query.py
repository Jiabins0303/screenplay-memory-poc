"""Stage 3 cognitive boundary query tests (PRD §7.3)."""

import time

import pytest
import pytest_asyncio

from tests.conftest import read_file


@pytest_asyncio.fixture
async def populated_client(memory_client):
    """A MemoryClient pre-loaded with scene_01, scene_02, scene_03."""
    await memory_client.ingest(read_file("scene_01.txt"), episode=1, scene=1)
    await memory_client.ingest(read_file("scene_02.txt"), episode=1, scene=2)
    await memory_client.ingest(read_file("scene_03.txt"), episode=2, scene=1)
    return memory_client


@pytest.mark.asyncio
async def test_query_returns_structured_result(populated_client):
    """3.1: Query returns expected schema."""
    result = await populated_client.query_cognitive(
        character="张伟",
        at_scene=2,
    )

    assert "character" in result
    assert "at_scene" in result
    assert "knows_facts" in result
    assert "knows_characters" in result
    assert isinstance(result["knows_facts"], list)
    assert isinstance(result["knows_characters"], list)


@pytest.mark.asyncio
async def test_query_zhang_wei_knows_after_revelation(populated_client):
    """3.2: 张伟 in episode 1 scene 2 should know about the adoption."""
    result = await populated_client.query_cognitive(
        character="张伟",
        at_scene_episode=1,
        at_scene_number=2,
    )

    facts_text = " ".join(result["knows_facts"])
    assert "领养" in facts_text or "身世" in facts_text, (
        f"张伟 should know 李静 被领养, got facts: {facts_text}"
    )


@pytest.mark.asyncio
async def test_query_zhou_yajing_does_not_know(populated_client):
    """3.3: 周雅静 in episode 2 scene 1 should NOT know her daughter is searching."""
    result = await populated_client.query_cognitive(
        character="周雅静",
        at_scene_episode=2,
        at_scene_number=1,
    )

    facts_text = " ".join(result["knows_facts"])
    assert "寻找" not in facts_text, f"unexpected '寻找' in: {facts_text}"
    assert "找她" not in facts_text, f"unexpected '找她' in: {facts_text}"


@pytest.mark.asyncio
async def test_query_includes_known_characters(populated_client):
    """3.4: knows_characters should contain 李静 for 张伟 by episode 1 scene 2."""
    result = await populated_client.query_cognitive(
        character="张伟",
        at_scene_episode=1,
        at_scene_number=2,
    )

    assert "李静" in result["knows_characters"], (
        f"张伟 should know 李静, got: {result['knows_characters']}"
    )


@pytest.mark.asyncio
async def test_query_performance(populated_client):
    """3.5: Query latency under 3 seconds."""
    start = time.time()
    await populated_client.query_cognitive(
        character="张伟",
        at_scene_episode=1,
        at_scene_number=2,
    )
    duration = time.time() - start
    assert duration < 3.0, f"query took {duration:.2f}s, exceeds 3s budget"
