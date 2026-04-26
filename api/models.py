"""Pydantic request / response models for the FastAPI surface.

Kept deliberately small: most writes accept a narrow object, most reads
return a plain dict. Graph payloads are JSON-ready so the frontend can
feed them directly into 3d-force-graph without a transform step.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Layer = Literal["detail", "hl", "bridge"]


# --- Projects --------------------------------------------------------------


class CreateProjectRequest(BaseModel):
    project_id: str | None = Field(
        default=None,
        description="Project namespace in Neo4j (group_id). Auto-generated if omitted.",
    )


class ProjectInfo(BaseModel):
    project_id: str
    created_at: str | None = None


# --- Ontology --------------------------------------------------------------


class OntologyFieldSpec(BaseModel):
    name: str
    type: str | dict  # "str" etc. OR {"kind": "literal", "values": [...]}
    optional: bool = False
    default: object | None = None
    description: str = ""


class OntologyEntitySpec(BaseModel):
    name: str
    description: str = ""
    fields: list[OntologyFieldSpec] = []


class OntologySpec(BaseModel):
    entities: list[OntologyEntitySpec] = []
    edges: list[OntologyEntitySpec] = []


# --- Ingest ----------------------------------------------------------------


class SceneInput(BaseModel):
    episode: int
    scene: int
    body: str


class IngestRequest(BaseModel):
    segmentation: list[SceneInput] = Field(
        ...,
        description="Scenes the user has already segmented. "
                    "Auto-segmentation from raw text is out of scope for MVP.",
    )
    run_hl: bool = Field(
        default=True,
        description="Also run the high-level beat extraction after detail ingest.",
    )
    force: bool = Field(
        default=False,
        description="Skip cache check and re-extract all scenes.",
    )


# --- Graph / edits ---------------------------------------------------------


class NodeDTO(BaseModel):
    uuid: str
    name: str | None = None
    labels: list[str] = []
    properties: dict = {}


class EdgeDTO(BaseModel):
    uuid: str | None = None
    source: str
    target: str
    type: str
    properties: dict = {}


class GraphDTO(BaseModel):
    nodes: list[NodeDTO]
    edges: list[EdgeDTO]


class UpdateNodeRequest(BaseModel):
    name: str | None = None
    properties: dict | None = None


class AddEdgeRequest(BaseModel):
    source_uuid: str
    target_uuid: str
    name: str
    fact: str = ""


class MergeNodesRequest(BaseModel):
    src_uuid: str
    dst_uuid: str


# --- Query -----------------------------------------------------------------


class QueryRequest(BaseModel):
    mode: Literal["cognitive", "search"] = "search"
    question: str = ""
    character: str | None = None
    at_scene_episode: int | None = None
    at_scene_number: int | None = None
