from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Scene(BaseModel):
    """剧本场次实体。

    每个场次对应一次 add_episode 调用。Scene 的 episode_number/scene_number
    必须从场次头 [本段为第X集第Y场] 抽出来；location 抓场次头里的地点描述。
    """

    episode_number: int = Field(default=0, description="集数, 从场次头 [本段为第X集第Y场] 抽")
    scene_number: int = Field(default=0, description="本集中的场次序号, 从场次头抽")
    location: str = Field(
        default="",
        description="场次头给出的地点描述，如'厉氏集团总裁办公室'、'苏家祖宅'",
    )
    time_of_day: Literal[
        "morning", "afternoon", "evening", "night", "unknown"
    ] = Field(
        default="unknown",
        description="场次时间段；优先取场次头里的明确时间，无则 unknown",
    )
