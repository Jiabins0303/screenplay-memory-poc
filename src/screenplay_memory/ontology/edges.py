# src/screenplay_memory/ontology/edges.py
"""Typed edges for the screenplay graph.

Three edge classes:
  * ScreenplayRelation — universal edge (witness_scope + relation_strength).
    Used for KNOWS / OCCURS_IN / MEMBER_OF / WORKS_FOR / IS_PERSONA_OF /
    POSSESSES / IS_TOKEN_OF / LOCATED_AT / RELATED_TO etc. The edge *name*
    is decided by the LLM at extraction time.
  * BelievesAbout — Character → Misunderstanding, with temporal fields.
  * KnowsSecret  — Character → Secret, with knowledge_source provenance.

`witness_scope` on ScreenplayRelation is the ABI for the cognitive query
system in `queries/cognitive.py`; do not rename or remove.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ScreenplayRelation(BaseModel):
    """通用剧本关系边 —— 携带认知归因 witness_scope 与关系强度。"""

    witness_scope: list[str] = Field(
        default_factory=list,
        description=(
            "知晓此关系的 Character 名字列表。必须严格按以下规则填写：\n"
            "\n"
            "【规则 1：明确否定】\n"
            "原文如果出现 'X 不知道 Y'、'X 还未察觉 Y'、'X 没意识到 Y' 等\n"
            "否定句，X 绝对不能进入 witness_scope。\n"
            "\n"
            "【规则 2：亲历/耳闻】\n"
            "如果某角色 X 说出、听到、目睹、参与了此事实，则把 X 加入\n"
            "witness_scope。例：'李静告诉张伟她被领养' → [李静, 张伟]。\n"
            "\n"
            "【规则 3：全知叙述】\n"
            "如果此事实是叙述者旁白，没有任何角色亲历（常伴随'她不知道'、\n"
            "'殊不知'、'此时此刻'等标记），witness_scope 留空 []。\n"
            "\n"
            "【规则 4：禁止推理】\n"
            "只依据文本字面证据，绝不凭常识或逻辑推断某角色'应当'知道。\n"
            "宁可留空，也不要补全。"
        ),
    )
    relation_strength: int = Field(
        default=3, ge=1, le=5,
        description="关系强度 1-5。1=表面/路人关系；3=认识有交集；5=核心羁绊或核心冲突。",
    )


class BelievesAbout(BaseModel):
    """Character → Misunderstanding 的边。

    专门承载"X 在 N 集开始误以为 Y 是 Z、M 集被揭穿"这一时间线。
    """

    since_episode: int = Field(
        default=0,
        description="自第几集开始持有此误会。0=未明确",
    )
    until_episode: int = Field(
        default=0,
        description="第几集被揭穿。0=尚未揭穿",
    )
    confidence: Literal["certain", "suspicious", "doubt"] = Field(
        default="certain",
        description="角色对这个错误认知的确信程度。certain=深信不疑；suspicious=半信半疑；doubt=已开始怀疑",
    )


class KnowsSecret(BaseModel):
    """Character → Secret 的边。谁、何时、如何知道此秘密。"""

    since_episode: int = Field(
        default=0,
        description="自第几集开始知晓。0=未明确",
    )
    knowledge_source: Literal[
        "witnessed", "told_by", "deduced", "born_with", "unknown"
    ] = Field(
        default="unknown",
        description=(
            "knowledge_source 来源：witnessed=亲眼目睹；told_by=被告知；"
            "deduced=自行推理；born_with=与生俱来/家族秘密；unknown=未明确"
        ),
    )
