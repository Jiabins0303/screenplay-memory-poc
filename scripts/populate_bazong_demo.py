#!/usr/bin/env python3
"""End-to-end ingest of tests/seed_data/scenes/ into the bazong_demo project.

Usage:
    python scripts/populate_bazong_demo.py [--clear-first] [--limit N]

Steps:
    1. (optional) clear bazong_demo group_id
    2. for each ep{NN}_sc{NN}.txt (capped by --limit if given): client.ingest(text)
    3. concat all ingested scenes; client.ingest_hl(scenes)
    4. attach_beats_to_scenes() bridge
    5. build_scene_index(detail) + build_scene_index(hl)
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

# Defensive: Graphiti occasionally returns very long int strings.
sys.set_int_max_str_digits(0)

from neo4j import AsyncGraphDatabase  # noqa: E402

from screenplay_memory.client import MemoryClient  # noqa: E402
from screenplay_memory.config import Settings  # noqa: E402
from screenplay_memory.queries.scene_index import build_scene_index  # noqa: E402

SCENES_DIR = ROOT / "tests" / "seed_data" / "scenes"
SCENE_RE = re.compile(r"ep(\d+)_sc(\d+)\.txt$")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clear-first", action="store_true")
    parser.add_argument("--project-id", default="bazong_demo")
    parser.add_argument(
        "--limit", type=int, default=0,
        help="ingest only the first N scenes (0 = all). Tier-1 dry-run uses 5.",
    )
    parser.add_argument(
        "--skip-hl", action="store_true",
        help="skip HL ingest (for tier-1 quick check)",
    )
    args = parser.parse_args()

    files = sorted(SCENES_DIR.glob("ep*_sc*.txt"))
    if not files:
        print(f"no scenes in {SCENES_DIR}", file=sys.stderr)
        return 1
    if args.limit > 0:
        files = files[: args.limit]
        print(f"--limit {args.limit}: ingesting first {len(files)} scenes only")

    mc = MemoryClient(project_id=args.project_id)
    ingested: list[tuple[int, int, str]] = []
    try:
        if args.clear_first:
            await mc.clear()
            print("cleared previous data")

        for path in files:
            m = SCENE_RE.search(path.name)
            if not m:
                continue
            ep, sc = int(m.group(1)), int(m.group(2))
            text = path.read_text(encoding="utf-8")
            t0 = time.time()
            print(f"→ ep{ep:02d}_sc{sc:02d} ({len(text)} chars)... ", flush=True, end="")
            await mc.ingest(text, episode=ep, scene=sc)
            print(f"{time.time() - t0:.1f}s")
            ingested.append((ep, sc, text))

        if not args.skip_hl and ingested:
            t0 = time.time()
            print(f"→ HL ingest ({len(ingested)} scenes)... ", flush=True, end="")
            await mc.ingest_hl(ingested)
            print(f"{time.time() - t0:.1f}s")

            t0 = time.time()
            print("→ attach_beats_to_scenes... ", flush=True, end="")
            await mc.attach_beats_to_scenes()
            print(f"{time.time() - t0:.1f}s")

    finally:
        await mc.close()

    # Inverse index
    s = Settings.from_env()
    driver = AsyncGraphDatabase.driver(
        s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password)
    )
    try:
        gids = [args.project_id]
        if not args.skip_hl:
            gids.append(f"{args.project_id}__hl")
        for gid in gids:
            counts = await build_scene_index(driver, group_id=gid)
            print(f"index {gid}: {counts}")
    finally:
        await driver.close()

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
