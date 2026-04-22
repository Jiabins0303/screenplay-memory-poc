"""Typed edges for the screenplay graph.

Stage 3 adds `witness_scope` — the list of characters who actually *know*
the fact encoded by this edge. It lets `query_character_knowledge` honor
cognitive boundaries (e.g. honor "她不知道…" narration in the source text)
instead of leaking narrator-omniscient facts into a character's POV.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ScreenplayRelation(BaseModel):
    """剧本关系边 —— 携带认知归因 witness_scope。

    Graphiti 会对每条新边调用 LLM，按 Pydantic 字段描述抽取属性。
    witness_scope 的定义见字段描述；严格依赖文本字面证据。
    """

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
