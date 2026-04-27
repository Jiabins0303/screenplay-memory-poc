from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Trope(BaseModel):
    """爆款套路标签 —— 短剧的"配方"标签。

    描述这部剧使用了哪些已被市场验证的爆款套路。每个 Trope 节点是一个套路标签，
    通过 BeatRelation(EMBODIES) 边连到具体的 Beat / Arc / Theme 上。

    抽取范围：抽 5-10 个对全剧最关键的套路即可，不要把每个常见配置都标。

    Examples:
        - 男主是冷面霸总 → Trope(trope_name="霸总人设", trope_category="character")
        - 男女主互相不知道对方真实身份 → Trope(trope_name="双向隐瞒", trope_category="plot")
        - 一夜契约结婚 → Trope(trope_name="契约结婚", trope_category="relationship")
    """

    trope_name: str = Field(
        description=(
            "套路名，常见值：'霸总人设'、'误会流'、'双向隐瞒'、'契约结婚'、"
            "'失忆'、'重生复仇'、'战神归来'、'豪门隐婚'、'灰姑娘逆袭'、"
            "'强势宠婚'、'校园暗恋'、'追妻火葬场'"
        ),
    )
    trope_category: Literal[
        "character", "plot", "relationship", "structure", "other"
    ] = Field(
        default="other",
        description=(
            "character=人物设定类；plot=情节套路；relationship=关系套路；"
            "structure=结构套路；other=其他"
        ),
    )
    popularity_score: int = Field(
        default=5,
        ge=1,
        le=10,
        description="此套路在 2024-2026 年短剧市场的流行度 1-10。LLM 自行估算。",
    )
