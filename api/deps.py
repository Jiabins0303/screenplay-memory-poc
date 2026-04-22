"""Per-project MemoryClient cache shared across request handlers.

Creating a MemoryClient pulls Settings from env and instantiates Graphiti
with its LLM / embedder / reranker clients — expensive enough that we
keep one per project for the lifetime of the process. The FastAPI
lifespan closes them on shutdown.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import Request

from screenplay_memory.client import MemoryClient


class ClientCache:
    def __init__(self) -> None:
        self._clients: dict[str, MemoryClient] = {}
        self._lock = asyncio.Lock()

    async def get(self, project_id: str) -> MemoryClient:
        async with self._lock:
            client = self._clients.get(project_id)
            if client is None:
                client = MemoryClient(project_id=project_id)
                self._clients[project_id] = client
            return client

    async def close_all(self) -> None:
        async with self._lock:
            for client in self._clients.values():
                await client.close()
            self._clients.clear()

    async def evict(self, project_id: str) -> None:
        async with self._lock:
            client = self._clients.pop(project_id, None)
            if client is not None:
                await client.close()


def get_cache(request: Request) -> ClientCache:
    """FastAPI dependency that returns the app-level cache."""
    return request.app.state.client_cache


async def get_client(project_id: str, cache: ClientCache) -> MemoryClient:
    return await cache.get(project_id)


# --- Neo4j driver access for project-list queries -------------------------
#
# For operations that don't target a single project (e.g. "list all
# projects"), we still reuse one of the cached clients' Graphiti driver.
# Creating a fresh MemoryClient just to list project IDs would burn a
# Graphiti init per request.


async def any_driver(cache: ClientCache) -> Any:
    # Prefer an existing cached client; otherwise bootstrap a "_meta"
    # client whose group_id is never used for real data.
    client = await cache.get("_meta")
    return client._graphiti.driver
