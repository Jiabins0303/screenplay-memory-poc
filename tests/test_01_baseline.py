"""Stage 1 baseline: prove Graphiti + Neo4j + Qwen2.5 round-trip Chinese."""

import pytest

from tests.conftest import get_all_entity_names, read_file


@pytest.mark.asyncio
async def test_baseline_chinese_ingestion(memory_client):
    """1.1: Simple Chinese text gets written to the graph."""
    result = await memory_client.ingest(
        content=read_file("basic_chinese.txt"),
        episode=1,
        scene=1,
    )

    assert result["status"] == "success"
    assert result["entities_created"] >= 2, (
        f"expected >=2 entities (李静, 张伟), got {result['entities_created']}"
    )
    assert result["facts_created"] >= 1, (
        f"expected >=1 fact, got {result['facts_created']}"
    )


@pytest.mark.asyncio
async def test_baseline_chinese_search(memory_client):
    """1.2: Chinese search returns relevant results."""
    await memory_client.ingest(
        content=read_file("basic_chinese.txt"),
        episode=1,
        scene=1,
    )

    results = await memory_client._graphiti.search(
        "李静的同学是谁",
        group_ids=[memory_client.project_id],
    )

    assert len(results) > 0, "search returned zero results for Chinese query"
    result_text = " ".join(str(r) for r in results)
    assert "李静" in result_text or "张伟" in result_text, (
        f"search result missing Chinese names: {result_text[:500]}"
    )


@pytest.mark.asyncio
async def test_baseline_no_english_pollution(memory_client):
    """1.3: Extracted entity names should not be translated into English."""
    await memory_client.ingest(
        content=read_file("basic_chinese.txt"),
        episode=1,
        scene=1,
    )

    nodes = await get_all_entity_names(memory_client)
    has_chinese = any(
        any("\u4e00" <= ch <= "\u9fff" for ch in name) for name in nodes
    )
    assert has_chinese, (
        f"All entity names appear to be non-Chinese — possible English "
        f"pollution from default Graphiti prompts. Got: {nodes}"
    )
