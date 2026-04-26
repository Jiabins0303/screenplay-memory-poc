from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Secret(BaseModel):
    """秘密 —— 只对部分角色公开的关键信息。

    与 Misunderstanding 互补：Secret 是被隐藏的真相；Misunderstanding 是错误认知。
    通过 KNOWS_SECRET 边连接到知情的 Character。

    Examples:
        - "苏念真实身份是苏家二小姐" → Secret(secret_content="苏念是苏家二小姐", secret_type="identity")
        - "厉北辰当年答应过苏念祖父要保护苏家" → Secret(secret_content="厉北辰对苏家祖父的承诺", secret_type="past_event")
    """

    secret_content: str = Field(description="秘密内容的一句话陈述")
    secret_type: Literal[
        "identity", "past_event", "relationship", "intention", "asset", "other"
    ] = Field(default="other")
