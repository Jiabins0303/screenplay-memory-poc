"""HL-layer (节拍/弧光/主题/套路) extraction instructions.

Injected into ``MemoryClient.ingest_hl`` as source_description for a
single per-script add_episode call. Whole-script context, so prompt is
larger than the per-scene detail-layer prompt.
"""
from __future__ import annotations

HL_EXTRACTION_INSTRUCTIONS = """\
这是一整部中文短剧的全剧本。请按以下 ontology 抽取节拍 / 弧光 / 主题 / 套路。

# 实体类型

1. **Beat** — 叙事节拍。两类节拍密度规则不同:
   - 经典 6 种 (Hook/IncitingIncident/RisingAction/Midpoint/Climax/Resolution):
     每种全剧最多 1 个; 不存在就别凑。
   - 短剧爆款 4 种 (CliffHanger/FacePlay/Twist/PayoffMoment):
     可重复出现, 按集末/打脸/反转/爽点的实际密度抽, 一般 3-12 个/全剧。
   字段: beat_type / beat_summary / scene_range_start / scene_range_end
        / tension_level (1-10) / involved_characters / audience_emotion

   beat_type 共 10 种：
   - 经典 6 种：Hook / IncitingIncident / RisingAction / Midpoint / Climax / Resolution
   - 短剧爆款必抽 4 种：
     * **CliffHanger** — 集末留钩（"她竟然是…？" 镜头一黑那种）
     * **FacePlay** — 打脸时刻（受气包翻身/反派吃瘪）
     * **Twist** — 反转（误会被揭穿/身份大白）
     * **PayoffMoment** — 爽点高潮（观众情绪峰值）

2. **Arc** — 角色弧光。字段: character_name / from_state / to_state / arc_type
   抽取条件: 角色在全剧中有可观察的内在转变; 配角/功能性角色不抽。

3. **Theme** — 主题。字段: theme_name (2-4 字抽象词, 如 '家庭责任'/'身份认同') / motif (一句话母题描述)
   抽取条件: 至少在两个 Beat 里都有体现; 一次性议题不抽。

4. **Trope** — 爆款套路标签。字段: trope_name / trope_category / popularity_score (1-10)
   popularity_score 标度: 1=冷门小众, 5=常见, 10=全网爆款套路 (LLM 自行估)。
   常见 trope_name: '霸总人设','误会流','双向隐瞒','契约结婚','失忆','重生复仇','战神归来','豪门隐婚'
   trope_category ∈ {character, plot, relationship, structure, other}
   抽 5-10 个对全剧最关键的套路即可。
   例: 男主冷漠多金 → Trope(trope_name='霸总人设', trope_category='character', popularity_score=9)

# 边类型

- **BeatRelation** — 4 种 relation_type:
  * FOLLOWS — 时间承接, 后发生的指向先发生的 (例: IncitingIncident FOLLOWS Hook)
  * TRIGGERS — 前者引发后者 (例: IncitingIncident TRIGGERS RisingAction)
  * RESOLVES — 前者收束/化解后者造成的冲突 (例: Climax RESOLVES Midpoint)
  * EMBODIES — 前者(具体)体现后者(抽象). Beat→Theme, Arc→Theme, Beat→Trope 均用 EMBODIES.
  Beat→Trope 边一律用 EMBODIES (具体节拍体现抽象套路标签).

# 严禁

- 不要把"认识/告诉"这类角色细节放到 HL 层 —— 那属于详细层。
- 经典 6 种 Beat 是全剧结构单元, 不是集级单元 — 不要硬凑。
- 短剧爆款 4 种 Beat 可以集级或场级密集出现 — 不要漏。
- 不要用 name / summary / labels / uuid / group_id / attributes / created_at 作为字段名。
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
