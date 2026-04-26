from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Location(BaseModel):
    """剧中场所。

    至少在 2 个不同 Scene 中出现的物理场所；只出现一次的不抽取。
    场所是物理空间，不是抽象组织（"厉氏集团总部"是 Location；"厉氏集团"是 Organization）。

    Examples:
        - "厉北辰的总裁办公室" → Location(loc_name="厉总办公室", loc_type="office")
        - "苏家祖宅" → Location(loc_name="苏家祖宅", loc_type="mansion")
    """

    loc_name: str = Field(description="场所名，如'厉总办公室'、'苏家祖宅'、'凯悦酒店'")
    loc_type: Literal[
        "office", "home", "mansion", "hotel", "hospital", "restaurant",
        "bar", "outdoor", "school", "prison", "temple", "other"
    ] = Field(
        default="other",
        description=(
            "场所类型: office=办公室; home=普通住宅; mansion=别墅/祖宅; "
            "hotel=酒店; hospital=医院; restaurant=餐厅; bar=酒吧/夜店; "
            "outdoor=户外; school=学校; prison=监狱/拘留所; temple=寺庙; other=其他"
        ),
    )
