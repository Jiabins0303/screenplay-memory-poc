# tests/test_01_ontology.py
"""Pure-Python tests for ontology modules. No Neo4j, no LLM, no async."""
from typing import Literal, get_args, get_origin

import pytest

from screenplay_memory.ontology import EDGE_TYPES, ENTITY_TYPES
from screenplay_memory.ontology_hl import HL_ENTITY_TYPES


EXPECTED_ENTITIES = {
    "Character", "Identity", "Family", "Organization",
    "Item", "Location", "Misunderstanding", "Secret",
    "Scene", "PlotEvent",
}
EXPECTED_EDGES = {"ScreenplayRelation", "BelievesAbout", "KnowsSecret"}
EXPECTED_HL_ENTITIES = {"Beat", "Arc", "Theme", "Trope"}
EXPECTED_BEAT_TYPES = {
    "Hook", "IncitingIncident", "RisingAction", "Midpoint",
    "Climax", "Resolution",
    "CliffHanger", "FacePlay", "Twist", "PayoffMoment",
}
PROTECTED_FIELDS = {
    "name", "summary", "labels", "uuid", "group_id",
    "attributes", "created_at", "name_embedding",
}


def test_entity_types_complete():
    assert set(ENTITY_TYPES.keys()) == EXPECTED_ENTITIES


def test_edge_types_complete():
    assert set(EDGE_TYPES.keys()) == EXPECTED_EDGES


def test_hl_entity_types_complete():
    assert set(HL_ENTITY_TYPES.keys()) == EXPECTED_HL_ENTITIES


def test_no_protected_field_names_used():
    """Graphiti EntityNode protects these names — using them raises EntityTypeValidationError."""
    for cls_name, cls in {**ENTITY_TYPES, **HL_ENTITY_TYPES}.items():
        bad = set(cls.model_fields.keys()) & PROTECTED_FIELDS
        assert not bad, f"{cls_name} uses protected field(s): {bad}"


@pytest.mark.parametrize("cls_name", sorted(EXPECTED_ENTITIES))
def test_entity_fields_use_whitelisted_types(cls_name):
    """Per CLAUDE.md, runtime customization only supports str/int/float/bool/list[str]/list[int]/Literal[...]."""
    cls = ENTITY_TYPES[cls_name]
    for fname, finfo in cls.model_fields.items():
        ann = finfo.annotation
        origin = get_origin(ann)
        if ann in (str, int, float, bool):
            continue
        if origin is Literal:
            continue
        if origin is list:
            inner = get_args(ann)[0]
            assert inner in (str, int), f"{cls_name}.{fname}: list[{inner}] not whitelisted"
            continue
        pytest.fail(f"{cls_name}.{fname}: type {ann!r} not in whitelist")


def test_character_status_tags_field():
    cls = ENTITY_TYPES["Character"]
    assert "status_tags" in cls.model_fields
    assert "role_type" in cls.model_fields
    assert "gender" in cls.model_fields


def test_identity_required_fields():
    cls = ENTITY_TYPES["Identity"]
    for f in ("persona_label", "is_real", "associated_skills"):
        assert f in cls.model_fields


def test_family_required_fields():
    cls = ENTITY_TYPES["Family"]
    for f in ("family_name", "family_alignment", "influence_level"):
        assert f in cls.model_fields


def test_organization_required_fields():
    cls = ENTITY_TYPES["Organization"]
    for f in ("org_name", "org_type"):
        assert f in cls.model_fields


def test_item_required_fields():
    cls = ENTITY_TYPES["Item"]
    for f in ("item_name", "item_role", "significance"):
        assert f in cls.model_fields


def test_location_required_fields():
    cls = ENTITY_TYPES["Location"]
    for f in ("loc_name", "loc_type"):
        assert f in cls.model_fields


def test_misunderstanding_required_fields():
    cls = ENTITY_TYPES["Misunderstanding"]
    for f in ("false_belief", "severity", "is_resolved"):
        assert f in cls.model_fields


def test_secret_required_fields():
    cls = ENTITY_TYPES["Secret"]
    for f in ("secret_content", "secret_type"):
        assert f in cls.model_fields


def test_screenplay_relation_fields():
    cls = EDGE_TYPES["ScreenplayRelation"]
    for f in ("witness_scope", "relation_strength"):
        assert f in cls.model_fields


def test_believes_about_fields():
    cls = EDGE_TYPES["BelievesAbout"]
    for f in ("since_episode", "until_episode", "confidence"):
        assert f in cls.model_fields


def test_knows_secret_fields():
    cls = EDGE_TYPES["KnowsSecret"]
    for f in ("since_episode", "knowledge_source"):
        assert f in cls.model_fields


def test_beat_has_10_types_including_viral():
    cls = HL_ENTITY_TYPES["Beat"]
    bt_field = cls.model_fields["beat_type"]
    assert get_origin(bt_field.annotation) is Literal
    assert set(get_args(bt_field.annotation)) == EXPECTED_BEAT_TYPES


def test_beat_has_audience_emotion():
    cls = HL_ENTITY_TYPES["Beat"]
    assert "audience_emotion" in cls.model_fields


def test_trope_required_fields():
    cls = HL_ENTITY_TYPES["Trope"]
    for f in ("trope_name", "trope_category", "popularity_score"):
        assert f in cls.model_fields


def test_scene_property_names_pinned_for_cross_module_contract():
    """annotations_hl.py and web/src/pages/Graph.tsx hardcode these names.
    Renaming them is a load-bearing breaking change — guard at the schema level."""
    cls = ENTITY_TYPES["Scene"]
    fields = set(cls.model_fields.keys())
    assert "episode_number" in fields, (
        "annotations_hl.py uses MATCH ... s.episode_number"
    )
    assert "scene_number" in fields, (
        "annotations_hl.py uses MATCH ... s.scene_number"
    )
    assert "location" in fields, (
        "web/src/pages/Graph.tsx and mockdata.ts read .properties.location"
    )
