from screenplay_memory.ontology.character import Character
from screenplay_memory.ontology.plot_event import PlotEvent
from screenplay_memory.ontology.scene import Scene

ENTITY_TYPES = {
    "Character": Character,
    "Scene": Scene,
    "PlotEvent": PlotEvent,
}

__all__ = ["Character", "Scene", "PlotEvent", "ENTITY_TYPES"]
