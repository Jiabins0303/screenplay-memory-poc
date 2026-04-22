"""Thin wrapper around sse-starlette so handlers can yield plain dicts."""

from __future__ import annotations

import json
from typing import AsyncIterator

from sse_starlette.sse import EventSourceResponse


def json_sse(events: AsyncIterator[dict]) -> EventSourceResponse:
    """Wrap an async iterator of dicts as an SSE response.

    Each dict must contain ``event`` (str) and ``data`` (any JSON-able).
    """

    async def formatted() -> AsyncIterator[dict]:
        async for ev in events:
            yield {
                "event": ev["event"],
                "data": json.dumps(ev.get("data", {}), ensure_ascii=False),
            }

    return EventSourceResponse(formatted())
