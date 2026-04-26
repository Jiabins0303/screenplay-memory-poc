#!/usr/bin/env python3
"""bazong_demo CLI driver — 记忆层在剧作中的价值 vs 裸 LLM。

Three demo acts:

    # Act 1 — 认知边界对比 (LLM with vs without memory)
    python scripts/demo.py ask --no-memory --character 厉北辰 --at 3,2 \\
        --q "在第3集第2场之前, 厉北辰知道苏念真实身份吗?"
    python scripts/demo.py ask --memory    --character 厉北辰 --at 3,2 \\
        --q "在第3集第2场之前, 厉北辰知道苏念真实身份吗?"

    # Act 2 — 多角色视角对比 (6 characters, side-by-side)
    python scripts/demo.py who-all --at 2,1

    # Act 3 — 节拍 + 套路统计 (HL layer)
    python scripts/demo.py beats
    python scripts/demo.py tropes

    # (optional) 续写下一场
    python scripts/demo.py continue --no-memory --at 2,1
    python scripts/demo.py continue --memory    --at 2,1

Flags:
    --replay   读缓存输出, 模拟 streaming(网络 flake 兜底 / 排练回放)
    --record   live 跑完把结果写缓存(排练时用)

Pre-flight (demo 开始前必须跑):
    python scripts/populate_bazong_demo.py --clear-first
"""

from __future__ import annotations

import argparse
import asyncio
import json
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


PROJECT = "bazong_demo"
HL_GID = f"{PROJECT}__hl"

SCENES_DIR = ROOT / "tests" / "seed_data" / "scenes"
CACHE_PATH = ROOT / "scripts" / "demo_cache.json"
NEXT_SCENE_PROMPT = ROOT / "scripts" / "scene_next_prompt.txt"

# 完整剧目演员表 — who-all 用
CHARACTERS = ["苏念", "厉北辰", "林婉婉", "林秘书", "陈伯", "赵心怡"]

# 给 ask --no-memory 时塞进 prompt 的剧情背景 (散文化, 不依赖具体场次原文)
PLOT_CONTEXT = (
    "剧目《八宗记》核心设定:\n"
    "- 苏念: 表面身份是厉氏集团一名普通会计, 实际身份是苏家二小姐, 隐姓埋名\n"
    "  进入厉氏, 是为了调查姐姐苏婉死亡真相 (怀疑是林家所为)。\n"
    "- 厉北辰: 厉氏集团总裁、冷面霸总。被祖父逼婚, 选择和苏念签订一年契约婚。\n"
    "- 林婉婉: 林家千金, 处处针对苏念, 以为苏念是想攀附厉总的拜金女。\n"
    "- 林秘书: 厉北辰贴身秘书, 负责执行调查苏念背景的指令。\n"
    "- 陈伯: 厉家老管家, 知道厉北辰小时候的婚约旧事。\n"
    "- 赵心怡: 厉北辰名义上的未婚妻人选, 后被契约婚搅局。\n"
    "核心套路: 契约婚 / 双向隐瞒 / 冷面霸总。\n"
    "关键节拍: 厉北辰直到很后期才会知道苏念真实身份 (Twist/CliffHanger 类节拍)。\n"
)


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


def load_seed_text(up_to_episode: int | None = None,
                   up_to_scene: int | None = None) -> str:
    """Concatenate ep*_sc*.txt scene files (sorted) up to (ep, sc) inclusive."""
    parts: list[str] = []
    for path in sorted(SCENES_DIR.glob("ep*_sc*.txt")):
        # parse ep_sc from filename: ep01_sc02.txt
        stem = path.stem  # ep01_sc02
        try:
            ep = int(stem[2:4])
            sc = int(stem[7:9])
        except ValueError:
            continue
        if up_to_episode is not None and up_to_scene is not None:
            if (ep, sc) > (up_to_episode, up_to_scene):
                continue
        parts.append(path.read_text(encoding="utf-8").strip())
    return "\n\n".join(parts)


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


async def cmd_beats(args: argparse.Namespace) -> None:
    """Act 3 part 1: list HL Beat rows, sorted by tension_level desc."""
    mc = MemoryClient(project_id=PROJECT)
    try:
        async with mc._graphiti.driver.session() as s:
            r = await s.run(
                "MATCH (b:Beat) WHERE b.group_id=$gid "
                "RETURN b.beat_type AS bt, b.tension_level AS tl, "
                "       b.beat_summary AS sm "
                "ORDER BY b.tension_level DESC",
                gid=HL_GID,
            )
            print(f"{'BeatType':<18} {'张力':>4}  概述")
            print("─" * 70)
            async for row in r:
                bt = row["bt"] or "(unknown)"
                tl_raw = row["tl"]
                tl = "  -" if tl_raw is None else f"{tl_raw:>4}"
                sm = (row["sm"] or "")[:50]
                print(f"{bt:<18} {tl}  {sm}")
    finally:
        await mc.close()


async def cmd_tropes(args: argparse.Namespace) -> None:
    """Act 3 part 2: list HL Trope rows, sorted by popularity_score desc."""
    mc = MemoryClient(project_id=PROJECT)
    try:
        async with mc._graphiti.driver.session() as s:
            r = await s.run(
                "MATCH (t:Trope) WHERE t.group_id=$gid "
                "RETURN t.trope_name AS n, t.trope_category AS c, "
                "       t.popularity_score AS p "
                "ORDER BY t.popularity_score DESC",
                gid=HL_GID,
            )
            print(f"{'套路':<20} {'类型':<14} {'流行度':>6}")
            print("─" * 50)
            async for row in r:
                name = row["n"] or "(unknown)"
                cat = row["c"] or "-"
                pop_raw = row["p"]
                pop = "  -" if pop_raw is None else f"{pop_raw:>6}"
                print(f"{name:<20} {cat:<14} {pop}")
    finally:
        await mc.close()


async def cmd_ask(args: argparse.Namespace) -> None:
    """Act 1 contrast: same question, --memory vs --no-memory."""
    cache = load_cache()
    key = cache_key(args)
    if args.replay and key in cache:
        print(f"[replay] {key}")
        simulated_stream(cache[key])
        return

    if args.memory:
        mc = MemoryClient(project_id=PROJECT)
        try:
            ep, sc = parse_at(args.at)
            result = await mc.query_cognitive(
                args.character, at_scene_episode=ep, at_scene_number=sc
            )
        finally:
            await mc.close()

        mem_block = json.dumps(result, ensure_ascii=False, indent=2)
        prompt = (
            "你是剧本助手, 正在回答关于剧目《八宗记》的问题。"
            "下面是从知识图谱查出的【角色认知记忆】 — 严格基于此回答, "
            "不要猜测记忆数据之外的事实。\n\n"
            f"【剧情背景】\n{PLOT_CONTEXT}\n"
            f"【角色认知记忆 (Graphiti)】\n{mem_block}\n\n"
            f"【问题】{args.q}\n\n"
            "要求:用 2-3 句话回答, 并在末尾用括号注明依据的字段 "
            "(例如 knows_facts / knows_characters)。"
        )
        banner = "━━ 有记忆: 先查 Graphiti → 把结构化认知记忆注入 prompt ━━"
    else:
        ep, sc = parse_at(args.at)
        seed = load_seed_text(up_to_episode=ep, up_to_scene=sc)
        prompt = (
            "你是剧本助手。下面是剧目《八宗记》的已写场次原文, 请回答问题。"
            "你只能依据原文中**显性出现**的台词/动作/旁白来推理, "
            "不要假设角色拥有原文里看不到的信息。\n\n"
            f"【剧情背景】\n{PLOT_CONTEXT}\n"
            f"【剧本原文 (≤ 第{ep}集第{sc}场)】\n{seed}\n\n"
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


async def cmd_who_all(args: argparse.Namespace) -> None:
    """Act 2: 6 characters, same scene, side-by-side cognitive comparison."""
    cache = load_cache()
    key = cache_key(args)
    if args.replay and key in cache:
        print(f"[replay] {key}")
        print(cache[key])
        return

    ep, sc = parse_at(args.at)
    mc = MemoryClient(project_id=PROJECT)
    try:
        results: dict[str, dict] = {}
        for ch in CHARACTERS:
            results[ch] = await mc.query_cognitive(
                ch, at_scene_episode=ep, at_scene_number=sc
            )
    finally:
        await mc.close()

    lines = [f"━━ {len(CHARACTERS)} 角色视角对比 @ S{ep:02d}E{sc:02d} ━━", ""]
    lines.append(f"{'角色':<8} {'#facts':>6}  认识的人")
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
    """Optional bonus: generate the NEXT scene; inject memory or not."""
    cache = load_cache()
    key = cache_key(args)
    if args.replay and key in cache:
        print(f"[replay] {key}")
        simulated_stream(cache[key])
        return

    ep, sc = parse_at(args.at)
    seed = load_seed_text(up_to_episode=ep, up_to_scene=sc)
    template = NEXT_SCENE_PROMPT.read_text(encoding="utf-8")

    if args.memory:
        mc = MemoryClient(project_id=PROJECT)
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
        banner = "━━ 有记忆: 续写前先查各角色 knows_facts → 注入 prompt ━━"
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


def _add_replay_flags(p: argparse.ArgumentParser) -> None:
    p.add_argument("--replay", action="store_true", help="Read cached output.")
    p.add_argument("--record", action="store_true", help="Save live output to cache.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_beats = sub.add_parser("beats", help="HL Beat table sorted by tension")
    _add_replay_flags(p_beats)

    p_tropes = sub.add_parser("tropes", help="HL Trope table sorted by popularity")
    _add_replay_flags(p_tropes)

    p_ask = sub.add_parser("ask", help="Act 1: memory vs no-memory contrast")
    _add_replay_flags(p_ask)
    _add_memory_flags(p_ask)
    p_ask.add_argument("--character", required=True)
    p_ask.add_argument("--at", required=True, help="episode,scene e.g. 3,2")
    p_ask.add_argument("--q", required=True)

    p_wall = sub.add_parser("who-all", help="Act 2: 6-character side-by-side")
    _add_replay_flags(p_wall)
    p_wall.add_argument("--at", required=True, help="episode,scene e.g. 2,1")

    p_cont = sub.add_parser("continue", help="bonus: generate next scene")
    _add_replay_flags(p_cont)
    _add_memory_flags(p_cont)
    p_cont.add_argument(
        "--at",
        required=True,
        help="episode,scene of the LAST ingested scene (next scene will be scene+1)",
    )

    return parser


HANDLERS = {
    "beats": cmd_beats,
    "tropes": cmd_tropes,
    "ask": cmd_ask,
    "who-all": cmd_who_all,
    "continue": cmd_continue,
}


def main() -> None:
    args = build_parser().parse_args()
    asyncio.run(HANDLERS[args.command](args))


if __name__ == "__main__":
    main()
