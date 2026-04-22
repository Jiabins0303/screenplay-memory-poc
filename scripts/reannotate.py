"""Re-run witness_scope annotation over the existing graph, without re-ingesting.

Idempotent. Cheap (no LLM calls). Use after changing annotation heuristics.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.set_int_max_str_digits(0)
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

from screenplay_memory.annotations import annotate_witness_scope  # noqa: E402
from screenplay_memory.client import MemoryClient  # noqa: E402


SEED_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "tests", "seed_data"
)


SCENES = [
    ("S01E01", "scene_01.txt"),
    ("S01E02", "scene_02.txt"),
    ("S02E01", "scene_03.txt"),
]


async def main() -> None:
    client = MemoryClient(project_id="test_project")
    for name, fname in SCENES:
        async with client._graphiti.driver.session() as sess:
            result = await sess.run(
                "MATCH (e:Episodic {name: $name}) WHERE e.group_id=$gid "
                "RETURN e.uuid AS uuid",
                name=name,
                gid=client.project_id,
            )
            rows = [r async for r in result]
        if not rows:
            print(f"! {name}: no Episodic node found, skipping")
            continue
        uuid = rows[0]["uuid"]
        with open(os.path.join(SEED_DIR, fname), encoding="utf-8") as f:
            raw = f.read()
        annotation = await annotate_witness_scope(
            client._graphiti, client.project_id, uuid, raw
        )
        print(f"{name}: {annotation}")
    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
