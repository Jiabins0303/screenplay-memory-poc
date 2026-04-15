"""Pronoun / zero-pronoun resolution for Chinese narrative text.

Runs *before* Graphiti, calling Qwen-7B directly via the OpenAI-compatible
DashScope endpoint. Replaces 他/她/他们/它 with explicit character names so
Graphiti's downstream extractor doesn't have to do pragmatics.
"""

from __future__ import annotations

from openai import AsyncOpenAI

from screenplay_memory.config import Settings

_PROMPT_TEMPLATE = """以下是一段中文剧本文本。请将其中的第三人称代词（他/她/他们/它）
替换为具体的角色名。已知角色：{known_characters}

规则：
1. 只替换叙述部分的代词，不要修改对白（双引号或中文引号内的内容）
2. 如果代词指代不明，保持原样
3. 不要修改任何其他内容
4. 不要添加任何解释或前后缀

原文：
{text}

只输出处理后的文本。"""


async def resolve_coreference(text: str, known_characters: list[str]) -> str:
    """Replace pronouns with explicit names. No-op if no known characters yet."""
    if not known_characters:
        return text

    s = Settings.from_env()
    client = AsyncOpenAI(api_key=s.qwen_api_key, base_url=s.qwen_api_base)
    try:
        resp = await client.chat.completions.create(
            model=s.qwen_small_model,
            messages=[
                {
                    "role": "user",
                    "content": _PROMPT_TEMPLATE.format(
                        known_characters="、".join(known_characters),
                        text=text,
                    ),
                }
            ],
            temperature=0.1,
        )
        resolved = (resp.choices[0].message.content or "").strip()
        return resolved or text
    finally:
        await client.close()
