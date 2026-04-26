#!/usr/bin/env python3
"""Build the scene inverse index for a project (and optional layer).

Usage:
    python scripts/build_scene_index.py --project-id bazong_demo
    python scripts/build_scene_index.py --project-id bazong_demo --layer hl
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from neo4j import AsyncGraphDatabase  # noqa: E402

from screenplay_memory.config import Settings  # noqa: E402
from screenplay_memory.queries.scene_index import build_scene_index  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--layer", choices=["detail", "hl"], default="detail")
    args = parser.parse_args()

    s = Settings.from_env()
    driver = AsyncGraphDatabase.driver(
        s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password)
    )
    try:
        gid = args.project_id if args.layer == "detail" else f"{args.project_id}__hl"
        counts = await build_scene_index(driver, group_id=gid)
        print(f"index built for {gid}: {counts}")
    finally:
        await driver.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
