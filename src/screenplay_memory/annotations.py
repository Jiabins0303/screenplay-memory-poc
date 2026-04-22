"""Post-ingest witness_scope annotation.

Graphiti's custom edge_types don't reliably bind to LLM-invented relation
names, so witness_scope is not populated during extraction. We run a
deterministic Cypher pass after each `add_episode` that writes it based on:

* **Presence rule** — every Character attached to an edge from this episode
  is added to that episode's witness_scope.
* **Negation rule** — if the source body flags a Character via
  "X 不知道 …" (explicit name) or "她/他 不知道 …" (pronoun; attributed to
  the scene's POV Character, defined as the first Character mentioned in
  the body), that Character is removed from witness_scope for every edge
  in this episode.

The heuristic is coarse (a negation anywhere excludes the character from
ALL edges of the scene) but aligned with how screenplay narration works:
cognitive isolation is usually scene-scoped, not edge-scoped.
"""

from __future__ import annotations

import re
from typing import Any


_PRONOUN_NEGATION = re.compile(r"[她他]\s*不知道")


def detect_negated_characters(body: str, present: list[str]) -> list[str]:
    """Return the Characters flagged by `不知道` narration in `body`.

    Two passes:
      1. Explicit — "{Name}[punct/space]不知道" → flag Name.
      2. Pronoun — if "她/他 不知道" appears and no explicit flag fired,
         attribute to the first Character mentioned in `body` (POV
         convention in Chinese narration).
    """
    negated: set[str] = set()

    for char in present:
        if re.search(rf"{re.escape(char)}\s*不知道", body):
            negated.add(char)

    if not negated and _PRONOUN_NEGATION.search(body):
        first = _first_character_in(body, present)
        if first:
            negated.add(first)

    return sorted(negated)


def _first_character_in(body: str, present: list[str]) -> str | None:
    positions = [(body.find(c), c) for c in present if body.find(c) >= 0]
    if not positions:
        return None
    positions.sort()
    return positions[0][1]


async def annotate_witness_scope(
    graphiti: Any,
    project_id: str,
    episode_uuid: str,
    body: str,
) -> dict:
    """Write `witness_scope` onto every edge attached to the episode.

    Returns a debug dict (`present`, `negated`, `witness_scope`) so callers
    can surface the decision to logs or tests.
    """
    async with graphiti.driver.session() as sess:
        # Use MENTIONS so we also count Characters that were extracted from
        # this episode but never got a relation edge (e.g. isolated POV
        # characters in narration-only scenes). Graphiti auto-links every
        # extracted entity to its source Episode via :MENTIONS.
        result = await sess.run(
            """
            MATCH (e:Episodic {uuid: $eid})-[:MENTIONS]->(c:Character)
            WHERE c.group_id = $gid
            RETURN DISTINCT c.name AS name
            """,
            gid=project_id,
            eid=episode_uuid,
        )
        present = sorted({row["name"] async for row in result if row["name"]})

    negated = detect_negated_characters(body, present)
    witness = [c for c in present if c not in negated]

    async with graphiti.driver.session() as sess:
        await sess.run(
            """
            MATCH ()-[r]->()
            WHERE r.group_id = $gid AND $eid IN r.episodes
            SET r.witness_scope = $witness
            """,
            gid=project_id,
            eid=episode_uuid,
            witness=witness,
        )

    return {
        "present": present,
        "negated": negated,
        "witness_scope": witness,
    }
