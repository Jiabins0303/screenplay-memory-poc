"""Post-ingest graph editing — pure Cypher, project-scoped.

Every operation filters by ``group_id`` so a bad ``project_id`` can never
reach across projects. Used by the FastAPI edit endpoints and by CLI
clean-up scripts. No LLM calls here.

Node / edge identity is the ``uuid`` property Graphiti assigns on creation;
never trust Neo4j's internal id() since it is not stable across restarts.
"""

from __future__ import annotations

import uuid as _uuid
from typing import Any


class EditError(RuntimeError):
    """Raised when a requested edit cannot be applied (missing node, wrong project, etc.)."""


async def rename_node(
    graphiti: Any, project_id: str, node_uuid: str, new_name: str
) -> dict:
    async with graphiti.driver.session() as sess:
        result = await sess.run(
            """
            MATCH (n {uuid: $uuid, group_id: $gid})
            SET n.name = $new_name
            RETURN n.uuid AS uuid, n.name AS name
            """,
            uuid=node_uuid,
            gid=project_id,
            new_name=new_name,
        )
        row = await result.single()
    if row is None:
        raise EditError(f"node {node_uuid} not found in project {project_id}")
    return {"uuid": row["uuid"], "name": row["name"]}


async def update_node_props(
    graphiti: Any, project_id: str, node_uuid: str, props: dict
) -> dict:
    """Merge ``props`` into the node's properties. Cannot change ``uuid`` or ``group_id``."""
    safe = {k: v for k, v in props.items() if k not in {"uuid", "group_id"}}
    async with graphiti.driver.session() as sess:
        result = await sess.run(
            """
            MATCH (n {uuid: $uuid, group_id: $gid})
            SET n += $props
            RETURN n
            """,
            uuid=node_uuid,
            gid=project_id,
            props=safe,
        )
        row = await result.single()
    if row is None:
        raise EditError(f"node {node_uuid} not found in project {project_id}")
    return dict(row["n"])


async def delete_node(graphiti: Any, project_id: str, node_uuid: str) -> int:
    async with graphiti.driver.session() as sess:
        result = await sess.run(
            """
            MATCH (n {uuid: $uuid, group_id: $gid})
            WITH n, count(n) AS hits
            DETACH DELETE n
            RETURN hits
            """,
            uuid=node_uuid,
            gid=project_id,
        )
        row = await result.single()
    hits = row["hits"] if row else 0
    if hits == 0:
        raise EditError(f"node {node_uuid} not found in project {project_id}")
    return hits


async def merge_nodes(
    graphiti: Any, project_id: str, src_uuid: str, dst_uuid: str
) -> dict:
    """Merge ``src`` into ``dst`` — ``dst`` survives.

    Uses APOC's ``apoc.refactor.mergeNodes``; all incoming and outgoing
    relationships of ``src`` are re-pointed at ``dst`` preserving type and
    properties, then ``src`` is deleted. The first element of the input
    list is the survivor.

    Safety: node matching is ``group_id``-scoped, but APOC re-points every
    incident relationship regardless of edge ``group_id``. To keep the
    file-level invariant "an edit can never reach across projects", we
    pre-check that ``src`` carries no edges whose ``group_id`` belongs to
    a different project, and refuse the merge if any such edges exist.
    Edges with ``group_id='bridge'`` (the HL→detail scene bridge) are
    allowed — they are expected cross-group links owned by this project.
    """
    if src_uuid == dst_uuid:
        raise EditError("cannot merge a node into itself")

    async with graphiti.driver.session() as sess:
        cross = await sess.run(
            """
            MATCH (src {uuid: $src, group_id: $gid})-[r]-()
            WHERE coalesce(r.group_id, $gid) <> $gid
              AND coalesce(r.group_id, '') <> 'bridge'
            RETURN count(r) AS bad
            """,
            src=src_uuid,
            gid=project_id,
        )
        row = await cross.single()
        bad = row["bad"] if row else 0
    if bad:
        raise EditError(
            f"merge refused: src={src_uuid} has {bad} relationship(s) "
            f"belonging to other projects; these would be silently migrated "
            f"into {project_id} by apoc.refactor.mergeNodes"
        )

    async with graphiti.driver.session() as sess:
        result = await sess.run(
            """
            MATCH (dst {uuid: $dst, group_id: $gid})
            MATCH (src {uuid: $src, group_id: $gid})
            WITH dst, src
            CALL apoc.refactor.mergeNodes(
                [dst, src],
                {properties: "discard", mergeRels: true}
            ) YIELD node
            RETURN node.uuid AS uuid
            """,
            dst=dst_uuid,
            src=src_uuid,
            gid=project_id,
        )
        row = await result.single()
    if row is None:
        raise EditError(
            f"merge failed: src={src_uuid} dst={dst_uuid} project={project_id} "
            f"(one or both nodes missing)"
        )
    return {"uuid": row["uuid"]}


async def add_edge(
    graphiti: Any,
    project_id: str,
    src_uuid: str,
    dst_uuid: str,
    *,
    name: str,
    fact: str = "",
) -> dict:
    """Create a user-authored edge between two nodes in this project.

    The edge carries a fixed ``:USER_EDGE`` label so it is distinguishable
    from LLM-extracted edges during audits. Cypher cannot parameterize
    relationship types, so the relation label is fixed — the ``name`` field
    stores the semantic verb (e.g. "认识", "告诉").
    """
    edge_uuid = str(_uuid.uuid4())
    async with graphiti.driver.session() as sess:
        result = await sess.run(
            """
            MATCH (a {uuid: $src, group_id: $gid})
            MATCH (b {uuid: $dst, group_id: $gid})
            CREATE (a)-[r:USER_EDGE {
                uuid: $euid,
                group_id: $gid,
                name: $name,
                fact: $fact,
                created_by: 'user'
            }]->(b)
            RETURN r.uuid AS uuid
            """,
            src=src_uuid,
            dst=dst_uuid,
            gid=project_id,
            euid=edge_uuid,
            name=name,
            fact=fact,
        )
        row = await result.single()
    if row is None:
        raise EditError(
            f"add_edge failed: src={src_uuid} dst={dst_uuid} project={project_id}"
        )
    return {"uuid": row["uuid"], "name": name, "fact": fact}


async def delete_edge(graphiti: Any, project_id: str, edge_uuid: str) -> int:
    # Directed match so each edge is matched once; an undirected `-[]-`
    # pattern would bind r twice and report 2 deletes for a single edge.
    async with graphiti.driver.session() as sess:
        result = await sess.run(
            """
            MATCH ()-[r {uuid: $euid, group_id: $gid}]->()
            WITH r, count(r) AS hits
            DELETE r
            RETURN hits
            """,
            euid=edge_uuid,
            gid=project_id,
        )
        row = await result.single()
    hits = row["hits"] if row else 0
    if hits == 0:
        raise EditError(f"edge {edge_uuid} not found in project {project_id}")
    return hits
