# src/screenplay_memory/ontology/character.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Character(BaseModel):
    """剧本中的角色实体。

    包括有名字的主角、配角、反派。不包括路人、群众、未具名角色。
    旧字段 identity:str 已废弃 —— 角色的多重身份用独立的 Identity 节点 + IS_PERSONA_OF 边表达。

    Examples:
        - "厉北辰走进办公室" → Character(name="厉北辰", role_type="protagonist", gender="male")
        - "一个保安经过" → 不抽取
    """

    role_type: Literal[
        "protagonist", "antagonist", "supporting", "antagonist_redeemed"
    ] = Field(
        default="supporting",
        description=(
            "protagonist=主角(故事核心)；antagonist=反派(主要冲突制造者)；"
            "supporting=配角；antagonist_redeemed=反派洗白后"
        ),
    )
    gender: Literal["male", "female", "unknown"] = Field(
        default="unknown",
    )
    status_tags: list[str] = Field(
        default_factory=list,
        description=(
            "角色状态标签，如['有钱','失忆','重生','双面身份','病娇','傲娇']。"
            "只放原文明确支持的标签；无证据宁可空。"
        ),
    )
