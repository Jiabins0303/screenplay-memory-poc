from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


BeatType = Literal[
    "Hook",
    "IncitingIncident",
    "RisingAction",
    "Midpoint",
    "Climax",
    "Resolution",
    "CliffHanger",
    "FacePlay",
    "Twist",
    "PayoffMoment",
]


class Beat(BaseModel):
    """叙事节拍 —— 全剧层面的结构单元。

    一个节拍覆盖一段连续场次，承载一个重要的叙事功能。短剧爆款常出现
    CliffHanger / FacePlay / Twist / PayoffMoment 这 4 种节拍，密度比传统
    长剧高得多 —— 抽取时不要漏。

    宁可不抽，也不要拼凑：如果某种节拍在剧本里不存在，就不要硬安排。

    Examples:
        - 开场李静和张伟争吵 → Beat(beat_type="Hook")
        - 集末"她竟然是苏家二小姐?" 镜头一黑 → Beat(beat_type="CliffHanger")
        - 受气包当众反击渣前男友 → Beat(beat_type="FacePlay")
        - 误会被揭穿 → Beat(beat_type="Twist")
        - 男主当众宣布女主是他妻子 → Beat(beat_type="PayoffMoment")
    """

    beat_type: BeatType = Field(
        description=(
            "Hook=开场钩子(抓住观众的首个冲突/悬念)；"
            "IncitingIncident=引发事件(打破主角现状)；"
            "RisingAction=主线推进(冲突升级)；"
            "Midpoint=中点逆转(剧情方向扭转)；"
            "Climax=高潮(主要冲突的决定性对抗)；"
            "Resolution=收束(结局与余韵)；"
            "CliffHanger=集末悬念(每集末尾留钩)；"
            "FacePlay=打脸时刻(受气包翻身/反派吃瘪)；"
            "Twist=反转(误会被揭穿/身份大白等)；"
            "PayoffMoment=爽点高潮(观众情绪峰值)"
        ),
    )
    beat_summary: str = Field(
        default="",
        description="该节拍的一句话中文概述，不超过 80 字。只描述剧情功能，不复述台词。",
    )
    scene_range_start: str = Field(
        default="",
        description="该节拍起始场次，格式 '集数-场次'，例如 '1-1'。如果不确定可留空。",
    )
    scene_range_end: str = Field(
        default="",
        description="该节拍结束场次，格式同上。单场节拍时 start 与 end 相同。",
    )
    tension_level: int = Field(
        default=3,
        ge=1,
        le=10,
        description="该节拍的戏剧张力 1-10。1=日常铺垫，10=核心高潮。用于 3D 可视化节点大小。",
    )
    involved_characters: list[str] = Field(
        default_factory=list,
        description="该节拍中出现的关键角色中文名列表（与详细层 Character 节点同名）。",
    )
    audience_emotion: Literal[
        "thrill", "satisfaction", "shock", "anger",
        "sweetness", "tension", "tear", "other",
    ] = Field(
        default="other",
        description=(
            "此节拍引发的主导观众情绪：thrill=爽/刺激；satisfaction=满足/解气；"
            "shock=震惊；anger=愤怒/憋屈；sweetness=甜蜜/糖；tension=紧张；"
            "tear=泪点；other=其他"
        ),
    )
