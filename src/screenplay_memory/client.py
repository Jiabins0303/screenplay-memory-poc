"""MemoryClient — facade over Graphiti for Chinese screenplay ingestion.

Stage 1 was a bare baseline. Stage 2 layers on:
  - Pydantic ontology (Character / Scene / PlotEvent) via `entity_types`
  - CHINESE_EXTRACTION_INSTRUCTIONS injected through `source_description`
  - Scene-header sentence prepended so the LLM extracts a Scene node
  - Coreference preprocessing (Qwen-7B) that runs before `add_episode`
"""

from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

from graphiti_core import Graphiti
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
from graphiti_core.nodes import EpisodeType

from screenplay_memory.annotations import annotate_witness_scope
from screenplay_memory.config import Settings
from screenplay_memory.chinese.coreference import resolve_coreference
from screenplay_memory.chinese.prompts import (
    CHINESE_EXTRACTION_INSTRUCTIONS,
    SCENE_HEADER_TEMPLATE,
)
from screenplay_memory.ontology import EDGE_TYPES, ENTITY_TYPES
from screenplay_memory.queries.cognitive import query_character_knowledge


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

    def __init__(self, project_id: str):
        self.project_id = project_id
        s = Settings.from_env()

        llm_config = LLMConfig(
            api_key=s.openrouter_api_key,
            model=s.chat_model,
            small_model=s.chat_small_model,
            base_url=s.openrouter_api_base,
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
        llm_client = OpenAIGenericClient(config=llm_config, max_tokens=max_tokens)
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
            self._initialized = True

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
            entity_types=ENTITY_TYPES,
            edge_types=EDGE_TYPES,
            previous_episode_uuids=prior_episodes,
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
        """Project-scoped wipe — only deletes nodes in this group_id."""
        async with self._graphiti.driver.session() as sess:
            await sess.run(
                "MATCH (n) WHERE n.group_id = $gid DETACH DELETE n",
                gid=self.project_id,
            )

    async def close(self) -> None:
        await self._graphiti.close()
