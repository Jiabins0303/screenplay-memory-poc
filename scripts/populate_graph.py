"""Ingest scenes 1-3 into Neo4j for visual inspection.

Bypasses pytest fixtures so we ingest exactly 3 times instead of 15
(= 5 tests × 3 scenes). Leaves the graph populated so you can open
http://localhost:7474 and run:

    MATCH (n) WHERE n.group_id='test_project' RETURN n LIMIT 50
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

# Graphiti sometimes sees LLM responses containing very long integers (e.g.
# echoed embedding-like strings). Python 3.11+ caps int→str at 4300 digits.
sys.set_int_max_str_digits(0)

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

from screenplay_memory.client import MemoryClient  # noqa: E402


SEED_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "tests", "seed_data"
)


def read_scene(name: str) -> str:
    with open(os.path.join(SEED_DIR, name), encoding="utf-8") as f:
        return f.read()


async def main() -> None:
    client = MemoryClient(project_id="test_project")
    await client.clear()
    scenes = [
        ("scene_01.txt", 1, 1),
        ("scene_02.txt", 1, 2),
        ("scene_03.txt", 2, 1),
    ]
    for scene_file, ep, sc in scenes:
        start = time.time()
        print(f"→ {scene_file} ep{ep} scene{sc} ...", flush=True)
        result = await client.ingest(
            read_scene(scene_file), episode=ep, scene=sc
        )
        elapsed = time.time() - start
        print(f"  done in {elapsed:.1f}s: {result}", flush=True)
    await client.close()
    print("\n✓ graph populated. Open http://localhost:7474 and run:")
    print("  MATCH (n) WHERE n.group_id='test_project' RETURN n LIMIT 50")


if __name__ == "__main__":
    asyncio.run(main())
