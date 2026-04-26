from __future__ import annotations

from pydantic import BaseModel, Field


class Identity(BaseModel):
    """角色的某一个身份/马甲/真实身份。

    一个 Character 可以有多个 Identity（例如：表面身份"普通会计"+ 真实身份"苏家二小姐"）。
    通过 IS_PERSONA_OF 边连接到 Character。

    Examples:
        - "苏念是厉氏集团的普通会计" → Identity(persona_label="厉氏集团会计", is_real=False)
        - "苏念真实身份是苏家二小姐" → Identity(persona_label="苏家二小姐", is_real=True)
    """

    persona_label: str = Field(
        default="",
        description=(
            "身份的简短标签 (可选; 留空时回落到 Graphiti 自动填的 name 字段). "
            "如'厉氏集团会计'、'苏家二小姐'、'前任未婚妻'."
        ),
    )
    is_real: bool = Field(
        default=False,
        description="True=真实身份；False=伪装/马甲/对外身份",
    )
    associated_skills: list[str] = Field(
        default_factory=list,
        description="此身份带来的关键能力，如['医术','商业谈判','调香']",
    )
