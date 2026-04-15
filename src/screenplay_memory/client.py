"""MemoryClient — facade over Graphiti for Chinese screenplay ingestion.

Stage 1 was a bare baseline. Stage 2 layers on:
  - Pydantic ontology (Character / Scene / PlotEvent) via `entity_types`
  - CHINESE_EXTRACTION_INSTRUCTIONS injected through `source_description`
  - Scene-header sentence prepended so the LLM extracts a Scene node
  - Coreference preprocessing (Qwen-7B) that runs before `add_episode`
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta

from graphiti_core import Graphiti
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
from graphiti_core.nodes import EpisodeType

from screenplay_memory.config import Settings
from screenplay_memory.chinese.coreference import resolve_coreference
from screenplay_memory.chinese.prompts import (
    CHINESE_EXTRACTION_INSTRUCTIONS,
    SCENE_HEADER_TEMPLATE,
)
from screenplay_memory.ontology import ENTITY_TYPES


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
            api_key=s.qwen_api_key,
            model=s.qwen_model,
            small_model=s.qwen_small_model,
            base_url=s.qwen_api_base,
        )
        llm_client = OpenAIGenericClient(config=llm_config)
        embedder = OpenAIEmbedder(
            config=OpenAIEmbedderConfig(
                api_key=s.embedding_api_key,
                embedding_model=s.embedding_model,
                embedding_dim=s.embedding_dim,
                base_url=s.embedding_api_base,
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

    async def ingest(self, content: str, episode: int, scene: int) -> dict:
        """Ingest a screenplay chunk.

        Pipeline: coreference → scene-header injection → Graphiti.add_episode
        with Pydantic entity_types and Chinese extraction instructions.
        """
        await self._ensure_init()

        known = await self._known_character_names()
        resolved = await resolve_coreference(content, known)

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
        )
        return {
            "status": "success",
            "entities_created": len(result.nodes),
            "facts_created": len(result.edges),
            "coreference_applied": bool(known),
        }

    async def clear(self) -> None:
        """Project-scoped wipe — only deletes nodes in this group_id."""
        async with self._graphiti.driver.session() as sess:
            await sess.run(
                "MATCH (n) WHERE n.group_id = $gid DETACH DELETE n",
                gid=self.project_id,
            )

    async def close(self) -> None:
        await self._graphiti.close()
