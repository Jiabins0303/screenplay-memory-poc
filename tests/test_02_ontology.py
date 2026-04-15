"""Stage 2 ontology + Chinese adaptation tests."""

import pytest

from tests.conftest import (
    get_edges_between,
    get_nodes_by_label,
    read_file,
)


@pytest.mark.asyncio
async def test_ontology_extracts_characters(memory_client):
    """2.1: Character entities are extracted with Chinese names."""
    await memory_client.ingest(
        content=read_file("scene_01.txt"),
        episode=1,
        scene=1,
    )

    characters = await get_nodes_by_label(memory_client, "Character")
    character_names = [c.get("name", "") for c in characters]

    assert "李静" in character_names, f"missing 李静, got: {character_names}"
    assert "张伟" in character_names, f"missing 张伟, got: {character_names}"


@pytest.mark.asyncio
async def test_ontology_extracts_plot_event(memory_client):
    """2.2: PlotEvent extracted for the adoption revelation."""
    await memory_client.ingest(
        content=read_file("scene_01.txt"),
        episode=1,
        scene=1,
    )

    events = await get_nodes_by_label(memory_client, "PlotEvent")
    assert len(events) >= 1, f"expected >=1 PlotEvent, got {len(events)}"

    descriptions = " ".join(str(e) for e in events)
    assert "领养" in descriptions, (
        f"no PlotEvent mentions 领养: {descriptions[:500]}"
    )


@pytest.mark.asyncio
async def test_ontology_creates_relationships(memory_client):
    """2.3: Edges exist between 李静 and 张伟."""
    await memory_client.ingest(
        content=read_file("scene_01.txt"),
        episode=1,
        scene=1,
    )

    forward = await get_edges_between(memory_client, "李静", "张伟")
    backward = await get_edges_between(memory_client, "张伟", "李静")

    assert len(forward) + len(backward) >= 1, (
        "李静 ↔ 张伟 should have at least one relationship edge"
    )


@pytest.mark.asyncio
async def test_ontology_pronoun_resolution(memory_client):
    """2.4: After coreference, pronouns should not appear as Character nodes."""
    await memory_client.ingest(
        content=read_file("scene_01.txt"),
        episode=1,
        scene=1,
    )

    chars = await get_nodes_by_label(memory_client, "Character")
    char_names = [c.get("name", "") for c in chars]

    assert "她" not in char_names, f"pronoun '她' leaked as Character: {char_names}"
    assert "他" not in char_names, f"pronoun '他' leaked as Character: {char_names}"
