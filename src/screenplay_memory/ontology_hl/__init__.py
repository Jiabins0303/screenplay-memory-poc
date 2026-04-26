"""High-level ("beat") ontology for the second-layer knowledge graph.

Captures narrative shape: 6 classic beats + 4 viral-specific beats
(CliffHanger, FacePlay, Twist, PayoffMoment), plus character Arcs,
Themes, and Tropes (爆款套路标签).
"""

from screenplay_memory.ontology_hl.arc import Arc
from screenplay_memory.ontology_hl.beat import Beat, BeatType
from screenplay_memory.ontology_hl.edges import BeatRelation
from screenplay_memory.ontology_hl.theme import Theme
from screenplay_memory.ontology_hl.trope import Trope

HL_ENTITY_TYPES = {
    "Beat": Beat,
    "Arc": Arc,
    "Theme": Theme,
    "Trope": Trope,
}

HL_EDGE_TYPES = {
    "BeatRelation": BeatRelation,
}

__all__ = [
    "Beat",
    "BeatType",
    "Arc",
    "Theme",
    "Trope",
    "BeatRelation",
    "HL_ENTITY_TYPES",
    "HL_EDGE_TYPES",
]
