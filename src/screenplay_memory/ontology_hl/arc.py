from __future__ import annotations

from pydantic import BaseModel, Field


class Arc(BaseModel):
    """角色弧光 —— 一个角色从起点到终点的心理/关系变化。

    不是每个角色都需要 Arc；只有在全剧中发生**可观察的内在转变**的
    角色才抽取。配角、功能性角色不抽。

    Examples:
        - 张伟从无忧大学生 → 被身世揭露后决心寻亲
          → Arc(character_name="张伟", from_state="无忧大学生",
               to_state="决心寻亲者", arc_type="觉醒")
    """

    character_name: str = Field(
        description="发生转变的角色中文名（需与详细层 Character 同名）",
    )
    from_state: str = Field(
        default="",
        description="角色在第一场/第一次出现时的心理或身份状态，不超过 20 字",
    )
    to_state: str = Field(
        default="",
        description="角色在最后一次出现时的状态，与 from_state 对比，不超过 20 字",
    )
    arc_type: str = Field(
        default="transformation",
        description=(
            "弧光类型。transformation=蜕变(正向成长)，"
            "fall=堕落(负向滑坡)，revelation=觉醒(知识冲击)，"
            "stagnation=困顿(努力未果)"
        ),
    )
