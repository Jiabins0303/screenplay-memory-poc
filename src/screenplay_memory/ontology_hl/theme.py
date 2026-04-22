from __future__ import annotations

from pydantic import BaseModel, Field


class Theme(BaseModel):
    """主题母题 —— 全剧反复出现的抽象议题。

    只抽取在至少两个节拍中都有体现的母题；一次性议题不抽。
    主题名用 2-4 字的中文抽象词（"身份认同"、"背叛"、"阶层"）。

    Examples:
        - 李静寻找生母、张伟质问父母 → Theme(name="血缘身份")
    """

    theme_name: str = Field(
        description="主题名称，2-4 字中文抽象词（如'血缘身份'、'阶层'、'救赎'）",
    )
    motif: str = Field(
        default="",
        description="该主题在剧中的具体呈现方式，不超过 40 字。",
    )
