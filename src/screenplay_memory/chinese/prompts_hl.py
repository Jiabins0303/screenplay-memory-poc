"""High-level extraction instructions for the 'beats' layer.

Unlike the detail layer, the HL pass ingests the *whole script* as a
single episode and asks the LLM to identify narrative beats, character
arcs, and recurring themes. Few-shot Chinese examples are essential —
without them, Qwen tends to conflate Hook with Inciting Incident, or to
invent beats that aren't in the text.
"""

HL_EXTRACTION_INSTRUCTIONS = """这是一段完整的中文剧本，分为多个场次。请按**叙事层**结构抽取，而不是详细剧情。

【输出语言】
所有实体名、字段值必须用中文，绝不要翻译成英文。

【核心目标】
识别剧本的宏观叙事结构，输出三类实体：
  1. Beat（节拍）—— 承载叙事功能的场次块
  2. Arc（弧光）—— 主要角色的心理/身份转变
  3. Theme（主题）—— 反复出现的抽象母题

【Beat 的六种类型 —— 一种最多一个】
  - Hook（开场钩子）：第一场里抓住观众注意力的首个冲突或悬念。
  - IncitingIncident（引发事件）：打破主角日常、迫使其进入主线的关键事件。
  - RisingAction（主线推进）：冲突升级的中段。
  - Midpoint（中点逆转）：剧情方向的扭转点。
  - Climax（高潮）：主要冲突的决定性对抗。
  - Resolution（收束）：结局与余韵。

【**短剧可能只有 3-4 个节拍** —— 宁可不抽，不要硬凑】
不存在的节拍类型请**完全不输出**，不要编造。

【Beat 字段】
  - beat_type：六选一
  - beat_summary：该节拍的一句话中文概述 ≤80 字，只写剧情功能
  - scene_range_start / scene_range_end：格式 "集-场"，如 "1-2"
  - tension_level：1-10 张力值（开场钩子一般 4-6，高潮 9-10）
  - involved_characters：该节拍出场的关键角色列表

【Arc 的抽取条件】
只有当角色在全剧中**有可观察的内在转变**时才抽。配角、功能性角色不抽。
from_state → to_state 必须能从文本字面证据支撑。

【Theme 的抽取条件】
只抽取至少在两个 Beat 里都有体现的母题。一次性议题不抽。
名称用 2-4 字中文抽象词。

【边类型 BeatRelation】
  - FOLLOWS：时间顺序（Hook FOLLOWS IncitingIncident 是错的，方向相反！）
  - TRIGGERS：前者引发后者（IncitingIncident TRIGGERS RisingAction）
  - RESOLVES：前者化解后者造成的冲突（Climax RESOLVES Midpoint）
  - EMBODIES：Beat→Theme 或 Arc→Theme

【禁止】
  - 不要把"李静告诉张伟"这类剧情细节抽成 Beat —— 那属于详细层
  - 不要为每一场都创建一个 Beat —— 一个 Beat 通常覆盖 2-5 场
  - 不要为次要角色抽 Arc

【少样本示例 1：三场短剧】
输入摘要：
  第1集第1场：李静冲进咖啡馆向张伟坦白自己被领养。
  第1集第2场：张伟消化后决定陪李静找生母。
  第1集第3场：两人出门前被李静养母阻拦，冲突爆发。
抽取：
  Beat(beat_type="IncitingIncident", beat_summary="李静向张伟坦白被领养身世，打破两人原有关系",
       scene_range_start="1-1", scene_range_end="1-1", tension_level=7,
       involved_characters=["李静", "张伟"])
  Beat(beat_type="RisingAction", beat_summary="张伟决定陪李静寻亲",
       scene_range_start="1-2", scene_range_end="1-2", tension_level=5,
       involved_characters=["张伟", "李静"])
  Beat(beat_type="Climax", beat_summary="养母阻拦引发正面冲突",
       scene_range_start="1-3", scene_range_end="1-3", tension_level=9,
       involved_characters=["李静", "张伟", "养母"])
  Arc(character_name="张伟", from_state="旁观伴侣", to_state="主动支持者",
       arc_type="transformation")
  Theme(theme_name="血缘身份", motif="围绕领养、寻亲、家庭羁绊反复出现")
  BeatRelation(relation_type="TRIGGERS", anchor_scene="1-1")
    # IncitingIncident → RisingAction
  BeatRelation(relation_type="RESOLVES", anchor_scene="1-3")
    # Climax → RisingAction

【少样本示例 2：没有明显 Hook 的剧本】
  如果第一场是慢节奏铺垫，没有钩子 → **不输出 Hook**。不要硬造。

【少样本示例 3：主题只出现一次】
  如果"阶层"只在某一场闪现一次 → **不输出 Theme**。主题需要至少两个 Beat 支撑。
"""

HL_SCENE_HEADER_TEMPLATE = "[全剧第{episode}集第{scene}场 — 叙事层]"


def build_hl_document(scenes: list[tuple[int, int, str]]) -> str:
    """Concatenate scenes into a single document for the HL extraction pass.

    Each scene is wrapped with ``HL_SCENE_HEADER_TEMPLATE`` so the LLM can
    emit ``scene_range_start`` / ``scene_range_end`` using the same
    "episode-scene" notation.
    """
    parts = []
    for episode, scene, body in scenes:
        header = HL_SCENE_HEADER_TEMPLATE.format(episode=episode, scene=scene)
        parts.append(f"{header}\n{body.strip()}")
    return "\n\n".join(parts)
