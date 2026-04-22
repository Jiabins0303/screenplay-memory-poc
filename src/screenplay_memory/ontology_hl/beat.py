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
]


class Beat(BaseModel):
    """叙事节拍 —— 全剧层面的结构单元。

    一个节拍覆盖一段连续的场次，承载一个重要的叙事功能（吸引注意、
    引发主线、升温冲突、逆转、高潮、收束）。一个剧本每种类型最多
    出现一个节拍；如果某个节拍在剧本里不存在（常见于短剧），
    宁可不抽取，也不要拼凑。

    Examples:
        - 开场李静和张伟争吵 → Beat(beat_type="Hook")
        - 领养身世被揭露 → Beat(beat_type="IncitingIncident")
    """

    beat_type: BeatType = Field(
        description=(
            "节拍类型。Hook=开场钩子(抓住观众的首个冲突/悬念)；"
            "IncitingIncident=引发事件(打破主角现状的关键事件)；"
            "RisingAction=主线推进(冲突升级)；"
            "Midpoint=中点逆转(剧情方向扭转)；"
            "Climax=高潮(主要冲突的决定性对抗)；"
            "Resolution=收束(结局与余韵)"
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
