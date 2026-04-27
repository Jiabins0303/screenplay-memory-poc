from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Item(BaseModel):
    """关键道具/信物。

    剧中承载情节意义的物品 —— 揭穿身份的玉佩、证明清白的录音、
    决定遗产的合同等。日常物品（杯子、手机、衣服）不抽取，
    除非它们承担情节作用。

    Examples:
        - "苏念脖子上的玉佩当年是厉北辰送的信物" → Item(item_name="玉佩", item_role="token")
    """

    item_name: str = Field(description="道具名，如'玉佩'、'离婚协议'、'录音笔'")
    item_role: Literal[
        "token", "evidence", "contract", "gift", "heirloom", "weapon", "other"
    ] = Field(
        default="other",
        description=(
            "token=信物/认人；evidence=证据；contract=合同协议；"
            "gift=礼物；heirloom=传家宝；weapon=武器；other=其他"
        ),
    )
    significance: str = Field(
        default="",
        description="此道具的剧情意义，一句话，如'揭穿苏念真实身份的关键信物'",
    )
