"""Fast cognitive-boundary verification against the current graph.

Skips pytest/fixture teardown so we don't re-ingest. Runs the same three
checks that test_03_query covers for 3.2, 3.3, 3.4.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.set_int_max_str_digits(0)
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

from screenplay_memory.client import MemoryClient  # noqa: E402


async def main() -> None:
    client = MemoryClient(project_id="test_project")

    checks = [
        ("3.2 张伟 knows 领养 at ep1s2", "张伟", 1, 2,
         lambda r: "领养" in " ".join(r["knows_facts"])
                   or "身世" in " ".join(r["knows_facts"])),
        ("3.3 周雅静 does NOT know 寻找 at ep2s1", "周雅静", 2, 1,
         lambda r: "寻找" not in " ".join(r["knows_facts"])
                   and "找她" not in " ".join(r["knows_facts"])),
        ("3.4 张伟 knows 李静 at ep1s2", "张伟", 1, 2,
         lambda r: "李静" in r["knows_characters"]),
    ]

    for label, char, ep, sc, predicate in checks:
        result = await client.query_cognitive(
            character=char, at_scene_episode=ep, at_scene_number=sc
        )
        ok = predicate(result)
        flag = "✓" if ok else "✗"
        print(f"{flag} {label}")
        print(f"   knows_facts: {result['knows_facts']}")
        print(f"   knows_characters: {result['knows_characters']}")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
