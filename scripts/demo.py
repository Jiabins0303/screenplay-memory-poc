#!/usr/bin/env python3
"""Live demo driver — 记忆层在剧作中的价值 vs 裸 LLM。

Usage:
    # Act 1 (认知边界打脸): 同问题, 切换 --memory / --no-memory
    python scripts/demo.py ask --no-memory --character 张伟 --at 1,1 \
        --q "在第1集第1场开场时,张伟知道李静是被领养的吗?"
    python scripts/demo.py ask --memory    --character 张伟 --at 1,1 \
        --q "在第1集第1场开场时,张伟知道李静是被领养的吗?"

    # Act 2 (多视角): 3角色在同一时间点的认知对比
    python scripts/demo.py who-all --at 1,2

    # Act 3 (彩蛋续写): 续写下一场, 记忆版 vs 裸 LLM
    python scripts/demo.py continue --no-memory --at 2,1
    python scripts/demo.py continue --memory    --at 2,1

Flags:
    --replay   读缓存输出,模拟 streaming(网络 flake 兜底 / 排练回放)
    --record   live 跑完把结果写缓存(排练时用)

Pre-flight (demo 开始前必须跑):
    python scripts/populate_graph.py   # 预灌 Neo4j, 冻结记忆
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

# Graphiti 偶尔会吐出超长数字串, 防御性关掉 int->str 上限
sys.set_int_max_str_digits(0)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from openai import AsyncOpenAI  # noqa: E402

from screenplay_memory.client import MemoryClient  # noqa: E402
from screenplay_memory.config import Settings  # noqa: E402


SEED_DIR = ROOT / "tests" / "seed_data"
CACHE_PATH = ROOT / "scripts" / "demo_cache.json"
NEXT_SCENE_PROMPT = ROOT / "scripts" / "scene_next_prompt.txt"
CHARACTERS = ["李静", "张伟", "周雅静"]


def load_seed_text() -> str:
    parts = []
    mapping = [("scene_01.txt", 1, 1), ("scene_02.txt", 1, 2), ("scene_03.txt", 2, 1)]
    for fname, ep, sc in mapping:
        p = SEED_DIR / fname
        if p.exists():
            parts.append(
                f"【第{ep}集第{sc}场】\n{p.read_text(encoding='utf-8').strip()}"
            )
    return "\n\n".join(parts)


def load_cache() -> dict:
    if CACHE_PATH.exists():
        raw = CACHE_PATH.read_text(encoding="utf-8").strip()
        if raw:
            return json.loads(raw)
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def cache_key(args: argparse.Namespace) -> str:
    fields = ["command", "memory", "character", "at", "q"]
    parts = [f"{f}={getattr(args, f, None)}" for f in fields if hasattr(args, f)]
    return "|".join(parts)


def parse_at(raw: str) -> tuple[int, int]:
    """'1,2' or '1.2' -> (1, 2)."""
    raw = raw.replace(".", ",")
    ep, sc = raw.split(",")
    return int(ep), int(sc)


async def stream_chat(prompt: str, model: str | None = None) -> str:
    """Stream tokens to stdout, return the full reply."""
    s = Settings.from_env()
    client = AsyncOpenAI(api_key=s.openrouter_api_key, base_url=s.openrouter_api_base)
    full: list[str] = []
    stream = await client.chat.completions.create(
        model=model or s.chat_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            print(delta, end="", flush=True)
            full.append(delta)
    print()
    return "".join(full)


def simulated_stream(text: str, chars_per_tick: int = 3, delay: float = 0.025) -> None:
    """Replay cached text with typing effect so --replay still feels live."""
    for i in range(0, len(text), chars_per_tick):
        print(text[i : i + chars_per_tick], end="", flush=True)
        time.sleep(delay)
    print()


# ---------- Commands ----------

async def cmd_ask(args: argparse.Namespace) -> None:
    """Act 1 / Act 3 contrast: same question, --memory vs --no-memory."""
    cache = load_cache()
    key = cache_key(args)
    if args.replay and key in cache:
        print(f"[replay] {key}")
        simulated_stream(cache[key])
        return

    if args.memory:
        mc = MemoryClient(project_id=args.project_id)
        try:
            ep, sc = parse_at(args.at)
            result = await mc.query_cognitive(
                args.character, at_scene_episode=ep, at_scene_number=sc
            )
        finally:
            await mc.close()

        mem_block = json.dumps(result, ensure_ascii=False, indent=2)
        prompt = (
            "你是剧本助手。请严格基于下面的【记忆数据】回答问题,"
            "不要猜测记忆数据之外的事实。\n\n"
            f"【记忆数据】\n{mem_block}\n\n"
            f"【问题】{args.q}\n\n"
            "要求:用 2-3 句话回答,并在末尾用括号注明依据的字段(例如 knows_facts)。"
        )
        banner = "━━ 有记忆: 先查 Graphiti → 把结构化记忆注入 prompt ━━"
    else:
        seed = load_seed_text()
        prompt = (
            "你是剧本助手。下面是剧本已有的场次原文,请回答问题。\n\n"
            f"【剧本原文】\n{seed}\n\n"
            f"【问题】{args.q}\n\n"
            "要求:用 2-3 句话回答。"
        )
        banner = "━━ 无记忆: 把原文全文塞 prompt, 让 LLM 自己推 ━━"

    print(banner)
    text = await stream_chat(prompt)

    if args.record:
        cache[key] = text
        save_cache(cache)
        print(f"[recorded] {key}")


async def cmd_who(args: argparse.Namespace) -> None:
    """Act 2 support: single character structured cognitive query."""
    cache = load_cache()
    key = cache_key(args)
    if args.replay and key in cache:
        print(f"[replay] {key}")
        print(cache[key])
        return

    ep, sc = parse_at(args.at)
    mc = MemoryClient(project_id=args.project_id)
    try:
        r = await mc.query_cognitive(
            args.character, at_scene_episode=ep, at_scene_number=sc
        )
    finally:
        await mc.close()

    lines = [f"━━ {args.character} @ S{ep:02d}E{sc:02d} ━━"]
    lines.append(f"knows_facts ({len(r['knows_facts'])}):")
    for f in r["knows_facts"]:
        lines.append(f"  • {f}")
    lines.append(
        f"knows_characters: {', '.join(r['knows_characters']) or '(无)'}"
    )
    lines.append(f"witnessed_events: {len(r['witnessed_events'])}")
    lines.append(f"cutoff: {r['query_metadata']['cutoff']}")
    lines.append(
        f"edges_scanned={r['query_metadata']['edges_scanned']}"
        f" kept={r['query_metadata']['edges_kept']}"
    )
    text = "\n".join(lines)
    print(text)

    if args.record:
        cache[key] = text
        save_cache(cache)
        print(f"[recorded] {key}")


async def cmd_who_all(args: argparse.Namespace) -> None:
    """Act 2 main: 3 characters, same scene, side-by-side."""
    cache = load_cache()
    key = cache_key(args)
    if args.replay and key in cache:
        print(f"[replay] {key}")
        print(cache[key])
        return

    ep, sc = parse_at(args.at)
    mc = MemoryClient(project_id=args.project_id)
    try:
        results: dict[str, dict] = {}
        for ch in CHARACTERS:
            results[ch] = await mc.query_cognitive(
                ch, at_scene_episode=ep, at_scene_number=sc
            )
    finally:
        await mc.close()

    lines = [f"━━ 3 角色视角对比 @ S{ep:02d}E{sc:02d} ━━", ""]
    lines.append(f"{'角色':<8} {'#facts':>6}  {'认识的人'}")
    lines.append("─" * 60)
    for ch, r in results.items():
        facts_n = len(r["knows_facts"])
        known = ", ".join(r["knows_characters"]) or "—"
        lines.append(f"{ch:<8} {facts_n:>6}  {known}")
    lines.append("")
    for ch, r in results.items():
        lines.append(f"▸ {ch} 知道的事:")
        if not r["knows_facts"]:
            lines.append("    (空 —— 此时刻该角色还没有任何被记录的事实)")
        for f in r["knows_facts"]:
            lines.append(f"    • {f}")
        lines.append("")
    text = "\n".join(lines)
    print(text)

    if args.record:
        cache[key] = text
        save_cache(cache)
        print(f"[recorded] {key}")


async def cmd_continue(args: argparse.Namespace) -> None:
    """Act 3 bonus: generate the NEXT scene; inject memory or not."""
    cache = load_cache()
    key = cache_key(args)
    if args.replay and key in cache:
        print(f"[replay] {key}")
        simulated_stream(cache[key])
        return

    ep, sc = parse_at(args.at)
    seed = load_seed_text()
    template = NEXT_SCENE_PROMPT.read_text(encoding="utf-8")

    if args.memory:
        mc = MemoryClient(project_id=args.project_id)
        try:
            memories: dict[str, dict] = {}
            for ch in CHARACTERS:
                r = await mc.query_cognitive(
                    ch, at_scene_episode=ep, at_scene_number=sc
                )
                memories[ch] = {
                    "knows_facts": r["knows_facts"],
                    "knows_characters": r["knows_characters"],
                }
        finally:
            await mc.close()

        mem_block = (
            "【各角色认知记忆 (查自 Graphiti)】\n"
            "严格遵守:每个角色只能说/做他当前知道的信息。\n"
            f"{json.dumps(memories, ensure_ascii=False, indent=2)}\n"
        )
        banner = "━━ 有记忆: 续写前先查 3 角色的 knows_facts → 注入 prompt ━━"
    else:
        mem_block = ""
        banner = "━━ 无记忆: 只喂原文, LLM 自己推每个角色该说什么 ━━"

    prompt = template.format(
        seed=seed, episode=ep, scene=sc + 1, memory_section=mem_block
    )
    print(banner)
    text = await stream_chat(prompt)

    if args.record:
        cache[key] = text
        save_cache(cache)
        print(f"[recorded] {key}")


# ---------- CLI wiring ----------

def _add_memory_flags(p: argparse.ArgumentParser) -> None:
    p.add_argument("--memory", dest="memory", action="store_true")
    p.add_argument("--no-memory", dest="memory", action="store_false")
    p.set_defaults(memory=True)


def _add_common_flags(p: argparse.ArgumentParser) -> None:
    """Flags every subcommand accepts (replay / record / project-id).

    Duplicated onto each subparser so users don't have to care about
    argparse's "flags before vs after subcommand" positional rule.
    """
    p.add_argument(
        "--project-id",
        default=os.getenv("DEMO_PROJECT_ID", "test_project"),
        help="Graphiti group_id (default: test_project)",
    )
    p.add_argument("--replay", action="store_true", help="Read cached output.")
    p.add_argument("--record", action="store_true", help="Save live output to cache.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_ask = sub.add_parser("ask")
    _add_common_flags(p_ask)
    _add_memory_flags(p_ask)
    p_ask.add_argument("--character", required=True)
    p_ask.add_argument("--at", required=True, help="episode,scene e.g. 1,2")
    p_ask.add_argument("--q", required=True)

    p_who = sub.add_parser("who")
    _add_common_flags(p_who)
    p_who.add_argument("--character", required=True)
    p_who.add_argument("--at", required=True)

    p_wall = sub.add_parser("who-all")
    _add_common_flags(p_wall)
    p_wall.add_argument("--at", required=True)

    p_cont = sub.add_parser("continue")
    _add_common_flags(p_cont)
    _add_memory_flags(p_cont)
    p_cont.add_argument(
        "--at",
        required=True,
        help="episode,scene of the LAST ingested scene (next scene will be scene+1)",
    )

    return parser


HANDLERS = {
    "ask": cmd_ask,
    "who": cmd_who,
    "who-all": cmd_who_all,
    "continue": cmd_continue,
}


def main() -> None:
    args = build_parser().parse_args()
    asyncio.run(HANDLERS[args.command](args))


if __name__ == "__main__":
    main()
