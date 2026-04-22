from pydantic import BaseModel, Field


class PlotEvent(BaseModel):
    """剧本中发生的关键事件。

    包括：冲突、揭露、转折、决定、行动结果。
    不包括：日常细节、环境描写、内心独白。

    Examples:
        - "李静告诉张伟她被领养的事" → PlotEvent
        - "李静喝了一口咖啡" → 不抽取
    """

    event_type: str = Field(
        default="action",
        description=(
            "事件类型。conflict=冲突，revelation=揭露，"
            "turning_point=转折，action=行动"
        ),
    )
    importance: int = Field(
        default=3,
        ge=1,
        le=5,
        description="重要性 1-5。5=对剧情有重大影响，1=次要细节",
    )
