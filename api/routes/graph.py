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

    if layer == "bridge":
        # Cross-layer view: Beat nodes from HL group + Scene/Beat nodes from
        # detail group + bridge-tagged edges (Beat-COVERS-Scene). Edges may
        # be empty when ``attach_beats_to_scenes`` produced no bridges
        # (e.g. Beat.scene_range_* missing) — we still return cleanly.
        node_query = """
            MATCH (n)
            WHERE (n.group_id = $gid_d
                   AND ('Scene' IN labels(n) OR 'Beat' IN labels(n)))
               OR (n.group_id = $gid_hl
                   AND ('Beat' IN labels(n) OR 'Theme' IN labels(n)
                        OR 'Arc' IN labels(n) OR 'Trope' IN labels(n)))
            RETURN n.uuid AS uuid,
                   n.name AS name,
                   labels(n) AS labels,
                   properties(n) AS props
            LIMIT $limit
        """
        edge_query = """
            MATCH (a)-[r]->(b) WHERE r.group_id = 'bridge'
            RETURN r.uuid AS uuid,
                   a.uuid AS src,
                   b.uuid AS dst,
                   type(r) AS type,
                   properties(r) AS props
            LIMIT $limit
        """
        node_params: dict[str, Any] = {
            "gid_d": project_id,
            "gid_hl": f"{project_id}__hl",
            "limit": limit,
        }
        edge_params: dict[str, Any] = {"limit": limit}
    else:
        gid = project_id if layer == "detail" else f"{project_id}__hl"
        node_query = """
            MATCH (n) WHERE n.group_id = $gid
            RETURN n.uuid AS uuid,
                   n.name AS name,
                   labels(n) AS labels,
                   properties(n) AS props
            LIMIT $limit
        """
        edge_query = """
            MATCH (a)-[r]->(b) WHERE r.group_id = $gid
            RETURN r.uuid AS uuid,
                   a.uuid AS src,
                   b.uuid AS dst,
                   type(r) AS type,
                   properties(r) AS props
            LIMIT $limit
        """
        node_params = {"gid": gid, "limit": limit}
        edge_params = {"gid": gid, "limit": limit}

    async with client._graphiti.driver.session() as sess:
        node_result = await sess.run(node_query, **node_params)
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

        edge_result = await sess.run(edge_query, **edge_params)
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
