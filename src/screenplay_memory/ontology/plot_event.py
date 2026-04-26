# src/screenplay_memory/ontology/plot_event.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PlotEvent(BaseModel):
    """关键剧情事件。

    可独立成节奏单元的剧情节点。粒度：一场剧通常 0-2 个 PlotEvent，
    不要把每句台词都抽成 event。
    """

    event_summary: str = Field(description="事件的一句话概述，不超过 60 字")
    event_type: Literal[
        "confrontation", "revelation", "decision",
        "transition", "emotional_peak", "other",
    ] = Field(
        default="other",
        description=(
            "confrontation=对峙/冲突；revelation=身份/真相揭穿；"
            "decision=人物做出关键抉择；transition=场景/情节过渡；"
            "emotional_peak=情感高潮（哭/告白/和解）；other=其他"
        ),
    )
