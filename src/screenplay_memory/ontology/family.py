from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Family(BaseModel):
    """剧中明确出现的家族单元（厉家、苏家、陆家等）。

    多人通过 MEMBER_OF 边归属同一 Family。临时小队、夫妻俩、合伙关系不抽。
    """

    family_name: str = Field(
        description="家族名，如'厉家'、'苏家'。必须有名字，不要抽'男主家'这种泛指。",
    )
    family_alignment: Literal["protagonist", "antagonist", "neutral"] = Field(
        default="neutral",
        description="protagonist=主角方家族；antagonist=敌对家族；neutral=配角/盟友家族",
    )
    influence_level: int = Field(
        default=3,
        ge=1, le=10,
        description="家族在剧中的影响力 1-10。1=路人家族；10=核心冲突方",
    )
