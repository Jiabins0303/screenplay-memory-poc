"""Graph snapshot endpoint — returns nodes + edges JSON-ready for d3/force-graph."""

from __future__ import annotations

from typing import Any

import neo4j.time as n4t
from fastapi import APIRouter, Depends

from api.deps import ClientCache, get_cache, get_client
from api.models import EdgeDTO, GraphDTO, Layer, NodeDTO

router = APIRouter(prefix="/projects/{project_id}/graph", tags=["graph"])


@router.get("", response_model=GraphDTO)
async def get_graph(
    project_id: str,
    layer: Layer = "detail",
    limit: int = 500,
    cache: ClientCache = Depends(get_cache),
) -> GraphDTO:
    client = await get_client(project_id, cache)
    gid = project_id if layer == "detail" else f"{project_id}__hl"

    async with client._graphiti.driver.session() as sess:
        node_result = await sess.run(
            """
            MATCH (n) WHERE n.group_id = $gid
            RETURN n.uuid AS uuid,
                   n.name AS name,
                   labels(n) AS labels,
                   properties(n) AS props
            LIMIT $limit
            """,
            gid=gid,
            limit=limit,
        )
        nodes = [
            NodeDTO(
                uuid=row["uuid"] or "",
                name=row["name"],
                labels=row["labels"] or [],
                properties=_sanitize_props(row["props"] or {}),
            )
            async for row in node_result
            if row["uuid"]
        ]

        edge_result = await sess.run(
            """
            MATCH (a)-[r]->(b) WHERE r.group_id = $gid
            RETURN r.uuid AS uuid,
                   a.uuid AS src,
                   b.uuid AS dst,
                   type(r) AS type,
                   properties(r) AS props
            LIMIT $limit
            """,
            gid=gid,
            limit=limit,
        )
        edges = [
            EdgeDTO(
                uuid=row["uuid"],
                source=row["src"] or "",
                target=row["dst"] or "",
                type=row["type"] or "",
                properties=_sanitize_props(row["props"] or {}),
            )
            async for row in edge_result
            if row["src"] and row["dst"]
        ]

    return GraphDTO(nodes=nodes, edges=edges)


def _sanitize_props(value: Any) -> Any:
    """Drop embedding vectors and convert Neo4j temporal types to ISO strings.

    Two problems we close here in one pass:

    1. Graphiti stores ``*_embedding`` on nodes — hundreds of floats that
       would 10× the response size. The frontend never reads them.
    2. ``properties(n)`` surfaces ``created_at`` (and any date-typed edge
       field) as ``neo4j.time.DateTime``, which Pydantic's JSON serializer
       refuses with ``PydanticSerializationError``. Convert to ISO-8601 so
       the whole response is JSON-safe without leaking driver types into
       the wire contract.

    Applied recursively so nested dicts/lists in Graphiti ``attributes``
    are also handled.
    """
    if isinstance(value, dict):
        return {
            k: _sanitize_props(v)
            for k, v in value.items()
            if not k.endswith("_embedding")
        }
    if isinstance(value, list):
        return [_sanitize_props(v) for v in value]
    if isinstance(value, (n4t.DateTime, n4t.Date, n4t.Time)):
        return value.to_native().isoformat()
    if isinstance(value, n4t.Duration):
        return value.iso_format()
    return value
