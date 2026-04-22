from screenplay_memory.ontology.character import Character
from screenplay_memory.ontology.edges import ScreenplayRelation
from screenplay_memory.ontology.plot_event import PlotEvent
from screenplay_memory.ontology.scene import Scene

ENTITY_TYPES = {
    "Character": Character,
    "Scene": Scene,
    "PlotEvent": PlotEvent,
}

EDGE_TYPES = {
    "ScreenplayRelation": ScreenplayRelation,
}

__all__ = [
    "Character",
    "Scene",
    "PlotEvent",
    "ScreenplayRelation",
    "ENTITY_TYPES",
    "EDGE_TYPES",
]
