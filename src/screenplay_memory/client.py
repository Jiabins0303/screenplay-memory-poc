"""MemoryClient — facade over Graphiti for Chinese screenplay ingestion.

Stage 1 was a bare baseline. Stage 2 layers on:
  - Pydantic ontology (Character / Scene / PlotEvent) via `entity_types`
  - CHINESE_EXTRACTION_INSTRUCTIONS injected through `source_description`
  - Scene-header sentence prepended so the LLM extracts a Scene node
  - Coreference preprocessing (Qwen-7B) that runs before `add_episode`
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone, timedelta
from typing import Any

from graphiti_core import Graphiti
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.config import LLMConfig
from screenplay_memory.llm_client import SmartModelClient
from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
from graphiti_core.nodes import EntityNode, EpisodeType
from graphiti_core.edges import EntityEdge


def _flatten_attrs(attrs: dict[str, Any] | None) -> dict[str, Any]:
    """Flatten LLM-returned attribute values for Neo4j compatibility.

    Neo4j only accepts primitive properties + arrays of primitives. Graphiti
    splats EntityNode.attributes / EntityEdge.attributes directly into the
    save query, so any nested dict (which the LLM occasionally returns in
    `attributes` like {'character_trait': {...}}) blows up with CypherTypeError.

    This helper walks each value: dicts/lists-of-dicts get JSON-serialized;
    primitives + lists-of-primitives pass through unchanged.
    """
    if not attrs:
        return {}
    out: dict[str, Any] = {}
    for k, v in attrs.items():
        if isinstance(v, dict):
            out[k] = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, list) and v and isinstance(v[0], (dict, list)):
            out[k] = json.dumps(v, ensure_ascii=False)
        else:
            out[k] = v
    return out


def _install_attribute_flattening_patch() -> None:
    """Monkey-patch EntityNode.save / EntityEdge.save to flatten attributes.

    Graphiti 0.x has no native protection against nested-map attribute values,
    and our Pydantic ontology is necessarily permissive (extras allowed)
    because Graphiti uses the `attributes` bag for any LLM-returned field
    not explicitly declared. Without this patch, a single LLM whim like
    'additional_info={...}' kills the whole add_episode call.
    """
    if getattr(EntityNode, "_screenplay_patched", False):
        return

    original_node_save = EntityNode.save
    original_edge_save = EntityEdge.save

    async def patched_node_save(self, driver):
        self.attributes = _flatten_attrs(self.attributes)
        return await original_node_save(self, driver)

    async def patched_edge_save(self, driver):
        self.attributes = _flatten_attrs(self.attributes)
        return await original_edge_save(self, driver)

    EntityNode.save = patched_node_save
    EntityEdge.save = patched_edge_save
    EntityNode._screenplay_patched = True
    EntityEdge._screenplay_patched = True


# ruff: noqa: E402 — helper definitions and the monkey-patch must be
# defined before the rest of the screenplay_memory imports below, because
# importing screenplay_memory.client must install the EntityNode/EntityEdge
# patch at process startup, before any MemoryClient() is constructed.
from screenplay_memory.annotations import annotate_witness_scope
from screenplay_memory.config import Settings
from screenplay_memory.chinese.coreference import resolve_coreference
from screenplay_memory.chinese.prompts import (
    CHINESE_EXTRACTION_INSTRUCTIONS,
    SCENE_HEADER_TEMPLATE,
)
from screenplay_memory.chinese.prompts_hl import (
    HL_EXTRACTION_INSTRUCTIONS,
    build_hl_document,
)
from screenplay_memory.ontology import EDGE_TYPES, ENTITY_TYPES
from screenplay_memory.ontology_customization import load_spec, spec_to_pydantic
from screenplay_memory.ontology_hl import HL_EDGE_TYPES, HL_ENTITY_TYPES
from screenplay_memory.queries.cognitive import query_character_knowledge

_install_attribute_flattening_patch()


# Anchor for synthetic per-scene reference times. Keeping it well in the past
# avoids collisions with `datetime.now()` calls elsewhere in Graphiti.
_BASE_EPOCH = datetime(2020, 1, 1, tzinfo=timezone.utc)


def _scene_reference_time(episode: int, scene: int) -> datetime:
    """Monotonic timestamp keyed off (episode, scene).

    Used so that Graphiti's temporal layer assigns ordered `valid_at` values
    even when the source text contains no explicit time markers.
    """
    return _BASE_EPOCH + timedelta(seconds=episode * 10000 + scene * 100)


class MemoryClient:
    """Single-tenant facade over Graphiti."""

    def __init__(
        self,
        project_id: str,
        *,
        entity_types_override: dict | None = None,
        edge_types_override: dict | None = None,
        hl_entity_types_override: dict | None = None,
        hl_edge_types_override: dict | None = None,
    ):
        self.project_id = project_id
        # None sentinel means "fall through to saved spec in Neo4j, then to
        # the module defaults". Resolution happens lazily in _ensure_init()
        # because load_spec() is async.
        self._entity_types_override = entity_types_override
        self._edge_types_override = edge_types_override
        self._hl_entity_types_override = hl_entity_types_override
        self._hl_edge_types_override = hl_edge_types_override
        # Populated during _ensure_init(). Default HL types come from the
        # built-in ontology_hl package; a persisted spec overrides them.
        self._entity_types = ENTITY_TYPES
        self._edge_types = EDGE_TYPES
        self._hl_entity_types: dict = HL_ENTITY_TYPES
        self._hl_edge_types: dict = HL_EDGE_TYPES

        s = Settings.from_env()

        llm_config = LLMConfig(
            api_key=s.openrouter_api_key,
            model=s.chat_model,
            small_model=s.chat_small_model,
            base_url=s.openrouter_api_base,
            temperature=0.2,
        )
        # max_tokens trade-off:
        # - Too high → OpenRouter 402 when the key's per-request credit
        #   budget is smaller than the reservation (fixable by raising
        #   the key's credit limit at openrouter.ai/settings/keys).
        # - Too low (~4096) → extraction JSON gets truncated, retry then
        #   emits malformed output that blows up Neo4j's codec.
        # 5000 is the empirical floor that still fits the extraction JSON;
        # bump to 8192 via LLM_MAX_TOKENS=8192 once the key has headroom.
        max_tokens = int(os.getenv("LLM_MAX_TOKENS", "5000"))
        llm_client = SmartModelClient(config=llm_config, max_tokens=max_tokens)
        embedder = OpenAIEmbedder(
            config=OpenAIEmbedderConfig(
                api_key=s.openrouter_api_key,
                embedding_model=s.embedding_model,
                embedding_dim=s.embedding_dim,
                base_url=s.openrouter_api_base,
            )
        )
        reranker = OpenAIRerankerClient(client=llm_client, config=llm_config)

        self._graphiti = Graphiti(
            s.neo4j_uri,
            s.neo4j_user,
            s.neo4j_password,
            llm_client=llm_client,
            embedder=embedder,
            cross_encoder=reranker,
        )
        self._initialized = False

    async def _ensure_init(self) -> None:
        if not self._initialized:
            await self._graphiti.build_indices_and_constraints()
            await self._resolve_ontology_overrides()
            self._initialized = True

    async def _resolve_ontology_overrides(self) -> None:
        """Pick the final entity_types / edge_types per layer.

        Precedence per layer: constructor kwarg > persisted OntologyConfig
        node in Neo4j > built-in module defaults.
        """
        if self._entity_types_override is not None:
            self._entity_types = self._entity_types_override
        else:
            spec = await load_spec(self._graphiti, self.project_id, "detail")
            if spec is not None:
                ents, edges = spec_to_pydantic(spec)
                self._entity_types = ents or ENTITY_TYPES
                if self._edge_types_override is None and edges:
                    self._edge_types = edges
        if self._edge_types_override is not None:
            self._edge_types = self._edge_types_override

        if self._hl_entity_types_override is not None:
            self._hl_entity_types = self._hl_entity_types_override
        else:
            spec_hl = await load_spec(self._graphiti, self.project_id, "hl")
            if spec_hl is not None:
                hl_ents, hl_edges = spec_to_pydantic(spec_hl)
                if hl_ents:
                    self._hl_entity_types = hl_ents
                if self._hl_edge_types_override is None and hl_edges:
                    self._hl_edge_types = hl_edges
        if self._hl_edge_types_override is not None:
            self._hl_edge_types = self._hl_edge_types_override

    async def _known_character_names(self) -> list[str]:
        """Existing Character nodes in this project — used to bootstrap coreference."""
        async with self._graphiti.driver.session() as sess:
            result = await sess.run(
                "MATCH (n:Character) WHERE n.group_id = $gid "
                "RETURN n.name AS name",
                gid=self.project_id,
            )
            return [r["name"] async for r in result]

    async def _recent_episode_uuids(self, limit: int = 5) -> list[str]:
        """Most recent Episodic UUIDs — passed to Graphiti so cross-scene
        references (e.g. '30年前送出的女儿' → 李静) resolve against earlier
        scenes instead of creating hallucinated new Characters."""
        async with self._graphiti.driver.session() as sess:
            result = await sess.run(
                "MATCH (e:Episodic) WHERE e.group_id = $gid "
                "RETURN e.uuid AS uuid "
                "ORDER BY e.created_at DESC LIMIT $limit",
                gid=self.project_id,
                limit=limit,
            )
            return [r["uuid"] async for r in result]

    async def _is_scene_ingested(self, episode: int, scene: int) -> bool:
        name = f"S{episode:02d}E{scene:02d}"
        async with self._graphiti.driver.session() as sess:
            result = await sess.run(
                "MATCH (e:Episodic {name: $name, group_id: $gid}) RETURN count(e) AS c",
                name=name, gid=self.project_id,
            )
            row = await result.single()
            return (row["c"] if row else 0) > 0

    async def _is_hl_ingested(self) -> bool:
        hl_gid = f"{self.project_id}__hl"
        async with self._graphiti.driver.session() as sess:
            result = await sess.run(
                "MATCH (e:Episodic {group_id: $gid}) RETURN count(e) AS c",
                gid=hl_gid,
            )
            row = await result.single()
            return (row["c"] if row else 0) > 0

    async def ingest(self, content: str, episode: int, scene: int) -> dict:
        """Ingest a screenplay chunk.

        Pipeline: coreference → scene-header injection → Graphiti.add_episode
        with Pydantic entity_types and Chinese extraction instructions.
        """
        await self._ensure_init()

        known = await self._known_character_names()
        resolved = await resolve_coreference(content, known)
        prior_episodes = await self._recent_episode_uuids()

        scene_header = SCENE_HEADER_TEMPLATE.format(episode=episode, scene=scene)
        body = f"{scene_header}\n\n{resolved}"
        ref_time = _scene_reference_time(episode, scene)

        result = await self._graphiti.add_episode(
            name=f"S{episode:02d}E{scene:02d}",
            episode_body=body,
            source_description=CHINESE_EXTRACTION_INSTRUCTIONS,
            source=EpisodeType.text,
            reference_time=ref_time,
            group_id=self.project_id,
            entity_types=self._entity_types,
            edge_types=self._edge_types,
            previous_episode_uuids=prior_episodes,
        )
        # Tag this Episodic with episode/scene metadata so the inverse-index
        # scene_index module can link it back to the extracted Scene node.
        # Match on name (S{ep}E{sc}) since Graphiti stores reference_time as
        # `valid_at` with driver-side datetime coercion that breaks equality.
        episodic_name = f"S{episode:02d}E{scene:02d}"
        async with self._graphiti.driver.session() as sess:
            await sess.run(
                """
                MATCH (e:Episodic)
                WHERE e.group_id=$gid AND e.name=$name
                SET e.episode_num=$ep, e.scene_num=$sc
                """,
                gid=self.project_id,
                name=episodic_name,
                ep=episode,
                sc=scene,
            )
        # Use the *raw* content for negation detection, not the coreference-
        # resolved body. When a new character (e.g. 周雅静) first appears,
        # coreference can mis-bind pronouns to already-known characters,
        # stripping the '她 不知道' signal. The original text is the only
        # reliable source for narration semantics.
        annotation = await annotate_witness_scope(
            self._graphiti, self.project_id, result.episode.uuid, content
        )
        return {
            "status": "success",
            "entities_created": len(result.nodes),
            "facts_created": len(result.edges),
            "coreference_applied": bool(known),
            "witness_scope": annotation["witness_scope"],
            "negated": annotation["negated"],
        }

    async def ingest_hl(self, scenes: list[tuple[int, int, str]]) -> dict:
        """Ingest the whole script into the high-level ("beat") layer.

        HL extraction runs **once per full script**, not per scene: the LLM
        needs the whole arc in context to decide what counts as Hook vs.
        Midpoint vs. Climax. Nodes and edges land under
        ``group_id=f"{project_id}__hl"`` so the detail layer is untouched.

        ``scenes`` is the same ``(episode, scene, body)`` tuple list used
        for detail ingest; we concatenate it with HL scene headers.
        """
        await self._ensure_init()

        body = build_hl_document(scenes)
        hl_gid = f"{self.project_id}__hl"
        # Use the last scene's synthetic timestamp as reference_time so HL
        # edges land at a time after all detail edges — avoids accidental
        # cross-layer temporal interleaving in search.
        last_ep, last_scene = (scenes[-1][0], scenes[-1][1]) if scenes else (1, 1)
        ref_time = _scene_reference_time(last_ep, last_scene + 1)

        result = await self._graphiti.add_episode(
            name=f"HL__{self.project_id}",
            episode_body=body,
            source_description=HL_EXTRACTION_INSTRUCTIONS,
            source=EpisodeType.text,
            reference_time=ref_time,
            group_id=hl_gid,
            entity_types=self._hl_entity_types,
            edge_types=self._hl_edge_types,
        )
        return {
            "status": "success",
            "layer": "hl",
            "entities_created": len(result.nodes),
            "facts_created": len(result.edges),
        }

    async def query_beats(self) -> list[dict]:
        """Return all Beat nodes in the HL layer, ordered by start scene.

        Used by the 3D viewer to populate the HL panel. Plain Cypher — no
        Graphiti search — because the HL graph is small (6-12 nodes) and
        we want deterministic ordering for the UI.
        """
        hl_gid = f"{self.project_id}__hl"
        async with self._graphiti.driver.session() as sess:
            result = await sess.run(
                """
                MATCH (b:Entity) WHERE b.group_id = $gid
                AND (b.beat_type IS NOT NULL OR 'Beat' IN labels(b))
                RETURN b ORDER BY b.scene_range_start ASC
                """,
                gid=hl_gid,
            )
            return [dict(row["b"]) async for row in result]

    async def query_cognitive(
        self,
        character: str,
        at_scene_episode: int | None = None,
        at_scene_number: int | None = None,
        *,
        at_scene: int | None = None,
    ) -> dict:
        """Cognitive boundary query.

        Accepts either form to bridge PRD §6.1 and §7.3:
          * `query_cognitive("张伟", at_scene=2)`
          * `query_cognitive("张伟", at_scene_episode=1, at_scene_number=2)`
        When only `at_scene` is given, episode defaults to 1.
        """
        if at_scene_episode is None and at_scene_number is None:
            if at_scene is None:
                raise ValueError(
                    "must provide at_scene or (at_scene_episode, at_scene_number)"
                )
            at_scene_episode = 1
            at_scene_number = at_scene
        elif at_scene_episode is None or at_scene_number is None:
            raise ValueError(
                "at_scene_episode and at_scene_number must be provided together"
            )

        cutoff = _scene_reference_time(at_scene_episode, at_scene_number + 1)
        return await query_character_knowledge(
            self._graphiti,
            self.project_id,
            character,
            at_scene_episode,
            at_scene_number,
            cutoff,
        )

    async def clear(self) -> None:
        """Project-scoped wipe — deletes detail layer, HL layer, and saved
        OntologyConfig for this project. Other projects are untouched."""
        hl_gid = f"{self.project_id}__hl"
        async with self._graphiti.driver.session() as sess:
            await sess.run(
                "MATCH (n) WHERE n.group_id IN $gids DETACH DELETE n",
                gids=[self.project_id, hl_gid],
            )
            await sess.run(
                "MATCH (c:OntologyConfig {project_id: $pid}) DETACH DELETE c",
                pid=self.project_id,
            )

    async def close(self) -> None:
        await self._graphiti.close()
