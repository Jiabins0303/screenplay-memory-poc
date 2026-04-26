from __future__ import annotations

from pydantic import BaseModel, Field


class Misunderstanding(BaseModel):
    """误会 —— 某角色持有的与事实不符的认知。

    误会流短剧的核心实体。仅当原文出现 '误以为/错以为/以为/认为是' 等明确语标时抽。
    通过 BELIEVES_ABOUT 边连接到持有此误会的 Character。

    Examples:
        - "厉北辰一直以为苏念是想攀附豪门的拜金女"
          → Misunderstanding(false_belief="苏念是拜金女")
        - "苏家以为大女儿当年是病死的，殊不知是被害"
          → Misunderstanding(false_belief="苏家大女儿是病死的")
    """

    false_belief: str = Field(
        description="错误认知的一句话陈述，必须是命题（X 是/不是/做了 Y）",
    )
    severity: int = Field(
        default=3, ge=1, le=5,
        description="误会严重程度 1-5。1=小笑话；5=驱动主线冲突的核心误会",
    )
    is_resolved: bool = Field(
        default=False,
        description="此误会在原文范围内是否已被揭穿",
    )
