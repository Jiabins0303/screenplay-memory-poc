from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


RelationType = Literal[
    "FOLLOWS",
    "TRIGGERS",
    "RESOLVES",
    "EMBODIES",
]


class BeatRelation(BaseModel):
    """节拍之间或节拍与主题/弧光之间的结构关系。

    常见形式：Hook FOLLOWS IncitingIncident、Climax RESOLVES Midpoint、
    某 Beat EMBODIES 某 Theme、某 Arc TRIGGERS 某 Beat。

    禁止把"认识"、"告诉"这类角色间的剧情细节放到这里 —— 那属于详细层。
    """

    relation_type: RelationType = Field(
        description=(
            "关系类型。FOLLOWS=时间上的承接；"
            "TRIGGERS=前者引发后者；"
            "RESOLVES=前者收束/化解后者造成的冲突；"
            "EMBODIES=前者体现了后者(节拍→主题、弧光→主题)"
        ),
    )
    anchor_scene: str | None = Field(
        default=None,
        description="如果该关系由某一具体场次承载，填入 '集-场' 格式；否则留空",
    )
