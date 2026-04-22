"""High-level ("beat") ontology for the second-layer knowledge graph.

This layer trades detail-granularity for structural clarity: instead of
per-scene Characters and PlotEvents, it captures the classic six-beat
skeleton (Hook, Inciting Incident, Rising Action, Midpoint, Climax,
Resolution) plus optional character Arcs and Themes. A screenwriter looks
at this graph to see narrative shape, not to debug continuity.

Stored in Neo4j under ``group_id = f"{project_id}__hl"`` so it sits beside
the detail layer but never mixes with it.
"""

from screenplay_memory.ontology_hl.arc import Arc
from screenplay_memory.ontology_hl.beat import Beat
from screenplay_memory.ontology_hl.edges import BeatRelation
from screenplay_memory.ontology_hl.theme import Theme

HL_ENTITY_TYPES = {
    "Beat": Beat,
    "Arc": Arc,
    "Theme": Theme,
}

HL_EDGE_TYPES = {
    "BeatRelation": BeatRelation,
}

__all__ = [
    "Beat",
    "Arc",
    "Theme",
    "BeatRelation",
    "HL_ENTITY_TYPES",
    "HL_EDGE_TYPES",
]
