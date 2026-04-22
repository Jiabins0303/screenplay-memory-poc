"""Graph snapshot endpoint — returns nodes + edges JSON-ready for d3/force-graph."""

from __future__ import annotations

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
                properties=_strip_embeddings(row["props"] or {}),
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
                properties=_strip_embeddings(row["props"] or {}),
            )
            async for row in edge_result
            if row["src"] and row["dst"]
        ]

    return GraphDTO(nodes=nodes, edges=edges)


def _strip_embeddings(props: dict) -> dict:
    """Remove embedding vectors from serialised properties.

    Graphiti stores ``name_embedding`` / ``summary_embedding`` on nodes —
    hundreds of floats. The frontend never needs them and shipping them
    can easily 10× the response size.
    """
    return {k: v for k, v in props.items() if not k.endswith("_embedding")}
