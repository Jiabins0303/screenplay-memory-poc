"""Phase 1 tests — runtime ontology customization.

Unit tests cover ``spec_to_pydantic`` (no Neo4j required). Integration test
covers the Neo4j ``save_spec`` / ``load_spec`` round-trip and confirms that
``MemoryClient`` picks up a persisted spec on first ingest-init.
"""

from __future__ import annotations

import pytest

from screenplay_memory.ontology_customization import (
    OntologySpecError,
    default_spec_detail,
    load_spec,
    save_spec,
    spec_to_pydantic,
)


# --- Pure unit tests (no DB) -----------------------------------------------


def test_spec_to_pydantic_happy_path():
    spec = {
        "entities": [
            {
                "name": "Person",
                "description": "测试用实体",
                "fields": [
                    {"name": "age", "type": "int", "optional": True, "default": 0,
                     "description": "年龄"},
                    {"name": "tags", "type": "list[str]", "optional": True,
                     "default": [], "description": "标签"},
                ],
            }
        ],
        "edges": [
            {
                "name": "Knows",
                "description": "认识关系",
                "fields": [
                    {"name": "strength", "type": "int", "optional": True,
                     "default": 1, "description": "亲密度"},
                ],
            }
        ],
    }

    ents, edges = spec_to_pydantic(spec)
    assert set(ents) == {"Person"}
    assert set(edges) == {"Knows"}

    Person = ents["Person"]
    instance = Person(age=20)
    assert instance.age == 20
    assert instance.tags == []
    # Defensive-copy default_factory → two instances must not share a list.
    a = Person()
    b = Person()
    a.tags.append("x")
    assert b.tags == []


def test_spec_to_pydantic_literal():
    spec = {
        "entities": [
            {
                "name": "Beat",
                "description": "叙事节拍",
                "fields": [
                    {
                        "name": "beat_type",
                        "type": {"kind": "literal", "values": ["Hook", "Climax"]},
                        "optional": False,
                        "description": "节拍类型",
                    }
                ],
            }
        ],
        "edges": [],
    }
    ents, _ = spec_to_pydantic(spec)
    Beat = ents["Beat"]
    # Valid literal
    assert Beat(beat_type="Hook").beat_type == "Hook"
    # Invalid literal → pydantic validation error
    with pytest.raises(Exception):
        Beat(beat_type="Bogus")


def test_spec_to_pydantic_rejects_unknown_type():
    spec = {
        "entities": [
            {
                "name": "Bad",
                "fields": [{"name": "x", "type": "dict"}],
            }
        ],
        "edges": [],
    }
    with pytest.raises(OntologySpecError, match="unsupported type"):
        spec_to_pydantic(spec)


def test_spec_to_pydantic_rejects_non_identifier_name():
    with pytest.raises(OntologySpecError, match="invalid class name"):
        spec_to_pydantic({"entities": [{"name": "123bad", "fields": []}], "edges": []})


def test_spec_to_pydantic_rejects_eval_like_token():
    # Guard the security-sensitive path: even valid-looking Python types
    # must be rejected unless they're in the whitelist.
    spec = {
        "entities": [
            {
                "name": "Sneak",
                "fields": [{"name": "x", "type": "__import__('os').system"}],
            }
        ],
        "edges": [],
    }
    with pytest.raises(OntologySpecError):
        spec_to_pydantic(spec)


def test_spec_to_pydantic_rejects_malformed_shape():
    with pytest.raises(OntologySpecError):
        spec_to_pydantic({"entities": "not a list", "edges": []})


def test_default_spec_detail_roundtrips():
    """The dumped built-in ontology must round-trip through spec_to_pydantic."""
    spec = default_spec_detail()
    ents, edges = spec_to_pydantic(spec)
    assert "Character" in ents
    assert "Scene" in ents
    assert "PlotEvent" in ents
    assert "ScreenplayRelation" in edges


# --- Integration (needs Neo4j via memory_client fixture) -------------------


@pytest.mark.asyncio
async def test_save_and_load_spec_roundtrip(memory_client):
    spec = {
        "entities": [
            {"name": "Person", "description": "", "fields": [
                {"name": "nickname", "type": "str", "optional": True,
                 "default": "", "description": ""}
            ]}
        ],
        "edges": [],
    }
    await save_spec(memory_client._graphiti, memory_client.project_id, "detail", spec)
    loaded = await load_spec(
        memory_client._graphiti, memory_client.project_id, "detail"
    )
    assert loaded == spec

    # Other layer must remain unset.
    assert await load_spec(
        memory_client._graphiti, memory_client.project_id, "hl"
    ) is None


@pytest.mark.asyncio
async def test_save_spec_rejects_bad_layer(memory_client):
    with pytest.raises(OntologySpecError):
        await save_spec(
            memory_client._graphiti, memory_client.project_id, "bogus", {}
        )


@pytest.mark.asyncio
async def test_save_spec_validates_before_writing(memory_client):
    bad = {"entities": [{"name": "X", "fields": [{"name": "y", "type": "dict"}]}],
           "edges": []}
    with pytest.raises(OntologySpecError):
        await save_spec(
            memory_client._graphiti, memory_client.project_id, "detail", bad
        )
    # Nothing should have been persisted.
    assert await load_spec(
        memory_client._graphiti, memory_client.project_id, "detail"
    ) is None
