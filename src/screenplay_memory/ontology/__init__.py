# src/screenplay_memory/ontology/__init__.py
from screenplay_memory.ontology.character import Character
from screenplay_memory.ontology.edges import (
    BelievesAbout,
    KnowsSecret,
    ScreenplayRelation,
)
from screenplay_memory.ontology.family import Family
from screenplay_memory.ontology.identity import Identity
from screenplay_memory.ontology.item import Item
from screenplay_memory.ontology.location import Location
from screenplay_memory.ontology.misunderstanding import Misunderstanding
from screenplay_memory.ontology.organization import Organization
from screenplay_memory.ontology.plot_event import PlotEvent
from screenplay_memory.ontology.scene import Scene
from screenplay_memory.ontology.secret import Secret

ENTITY_TYPES = {
    "Character": Character,
    "Identity": Identity,
    "Family": Family,
    "Organization": Organization,
    "Item": Item,
    "Location": Location,
    "Misunderstanding": Misunderstanding,
    "Secret": Secret,
    "Scene": Scene,
    "PlotEvent": PlotEvent,
}

EDGE_TYPES = {
    "ScreenplayRelation": ScreenplayRelation,
    "BelievesAbout": BelievesAbout,
    "KnowsSecret": KnowsSecret,
}

__all__ = [
    "Character",
    "Identity",
    "Family",
    "Organization",
    "Item",
    "Location",
    "Misunderstanding",
    "Secret",
    "Scene",
    "PlotEvent",
    "ScreenplayRelation",
    "BelievesAbout",
    "KnowsSecret",
    "ENTITY_TYPES",
    "EDGE_TYPES",
]
