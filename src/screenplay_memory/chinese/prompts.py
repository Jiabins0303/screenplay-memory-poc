"""中文剧本抽取指令 — 由 client.py 注入到 graphiti.add_episode 的 source_description。

These instructions are the entire prompt budget Graphiti gives us via
``source_description``. They must be terse but unambiguous. Each example
is real Graphiti extraction shape (not pseudo-JSON).

When extraction quality regresses, edit the example block here FIRST
before touching client.py — examples drive LLM behavior more than rules.
"""
from __future__ import annotations

SCENE_HEADER_TEMPLATE = "[本段为第{episode}集第{scene}场]"


CHINESE_EXTRACTION_INSTRUCTIONS = """\
这是一段中文短剧剧本。请按以下 ontology 抽取实体和关系。

# 实体类型

1. **Character** — 有名字的角色（主角/配角/反派）。路人不抽。
   字段：role_type / gender / status_tags
   例：'厉北辰走进办公室' → Character(name='厉北辰', role_type='protagonist', gender='male')

2. **Identity** — 角色的身份/马甲/职业头衔. **必抽** —— 任何描述某角色"身份是X"、"X的身份"、"在X集团做Y"、"是Y家族的Z"、"自称X"、"原本是X"、"真实身份是X" 都必须抽 Identity 节点. 一个 Character 通常有 1-3 个 Identity (公开身份 + 真实身份).
   字段: persona_label (必填, 一个简短的身份标签) / is_real (False=马甲/对外身份, True=真实身份) / associated_skills (可选)

   抽取触发词 (出现任一就必须抽): 身份, 马甲, 总裁, 总监, 经理, 秘书, 会计, 律师, 医生, 千金, 少爷, 二小姐, 大小姐, 长子, 长女, 少帅, 太太, 夫人, 家主, 董事长, 老板, 教授, 学生, 警察, 军官, 前任未婚妻, 现任未婚妻, 前男友, 前女友.

   例 A: '厉北辰是厉氏集团总裁' → Identity(persona_label='厉氏集团总裁', is_real=True)
   例 B: '苏念表面是普通会计, 真实身份是苏家二小姐'
       → Identity(persona_label='厉氏集团会计', is_real=False)
       → Identity(persona_label='苏家二小姐', is_real=True, associated_skills=['医术'])
   例 C: '林婉婉是林氏千金, 也是厉北辰的前任未婚妻'
       → Identity(persona_label='林氏集团千金', is_real=True)
       → Identity(persona_label='厉北辰的前任未婚妻', is_real=True)

   **每个 Identity 必须配一条 ScreenplayRelation 边 (relation_type=IS_PERSONA_OF), 从 Character 指向 Identity, 否则 Identity 节点会孤立.**

3. **Family** — 有名字的家族单元（厉家/苏家）。临时小队不抽。
   字段：family_name / family_alignment / influence_level
   例：'厉家是江城三大家族之首' → Family(family_name='厉家', family_alignment='protagonist', influence_level=10)

4. **Organization** — 组织/公司/机构。Family=血缘；Organization=契约/雇佣。
   字段：org_name / org_type
   例：'厉氏集团' → Organization(org_name='厉氏集团', org_type='company')

5. **Item** — 承载剧情的关键道具/信物。日常物品（杯子、手机）不抽。
   字段：item_name / item_role / significance
   例：'苏念脖子上的玉佩是当年厉北辰送的'
       → Item(item_name='玉佩', item_role='token', significance='揭穿苏念真实身份的关键信物')

6. **Location** — 至少在 2 个不同场次出现的物理场所。一次性场所不抽。
   字段：loc_name / loc_type
   例：'厉总办公室' → Location(loc_name='厉总办公室', loc_type='office')

7. **Misunderstanding** — 角色的错误认知。仅当原文出现 '误以为/错以为/以为/认为是' 等明确语标。
   字段：false_belief / severity / is_resolved
   例：'厉北辰一直以为苏念是想攀附豪门的拜金女'
       → Misunderstanding(false_belief='苏念是拜金女', severity=5, is_resolved=False)

8. **Secret** — 只对部分角色公开的真相。与 Misunderstanding 互补。
   字段：secret_content / secret_type
   例：'苏念真实身份是苏家二小姐'
       → Secret(secret_content='苏念是苏家二小姐', secret_type='identity')

9. **Scene** — 场次实体, **本段开头一定有, 必抽 1 个**. 文本开头的标记 `[本段为第X集第Y场]` 就是 Scene 的来源.
   字段: episode_number (来自'第X集'的X) / scene_number (来自'第Y场'的Y) / location / time_of_day
   location 抓 '场景: XX' 里的 XX (如 '厉总办公室'); time_of_day 抓 '时间: XX' (上午/下午/夜 → morning/afternoon/night).

   例: 文本以 '[本段为第3集第2场]\n场景: 凯悦酒店 / 时间: 夜' 开头
       → Scene(episode_number=3, scene_number=2, location='凯悦酒店', time_of_day='night')

10. **PlotEvent** — 关键剧情事件。字段: event_summary (≤60 字) / event_type
    event_type ∈ {confrontation, revelation, decision, transition, emotional_peak, other}
    一场剧通常 0-2 个, 不要把每句台词都抽。

# 边类型

- **ScreenplayRelation** (通用) — 边名 (relation type) 在以下控制词表中选, 不要自己造新词:
    KNOWS / IS_PERSONA_OF / MEMBER_OF / WORKS_FOR / POSSESSES / IS_TOKEN_OF
    / LOCATED_AT / OCCURS_IN / RELATED_TO
  字段: witness_scope (认知归因, 规则见下) + relation_strength (1-5)
- **BelievesAbout**（Character → Misunderstanding）— 字段：since_episode / until_episode / confidence
- **KnowsSecret**（Character → Secret）— 字段：since_episode / knowledge_source

# witness_scope 严格规则

【规则 1：明确否定】原文 'X 不知道 Y' / 'X 还未察觉 Y' → X 绝对不进 witness_scope
【规则 2：亲历/耳闻】X 说出/听到/目睹/参与 → X 进 witness_scope
【规则 3：全知叙述】旁白 / '殊不知' / '此时此刻' → witness_scope 留空 []
【规则 4：禁止推理】只依据字面证据，宁可空也不补全

# 边示例 (新增 BelievesAbout / KnowsSecret 时必填字段)

例 1: '厉北辰一直以为苏念是拜金女, 第8集真相揭穿'
  → BelievesAbout(Character('厉北辰') → Misunderstanding('苏念是拜金女'),
                  since_episode=1, until_episode=8, confidence='certain')

例 2: '管家在场目睹苏念取出玉佩'
  → KnowsSecret(Character('管家') → Secret('苏念是苏家二小姐'),
                since_episode=3, knowledge_source='witnessed')

例 3: '苏念表面是会计, 真实身份是苏家二小姐'
  → ScreenplayRelation(Character('苏念') --IS_PERSONA_OF--> Identity('厉氏集团会计'))
  → ScreenplayRelation(Character('苏念') --IS_PERSONA_OF--> Identity('苏家二小姐'))

# 角色名规则

- 抽取中文人名（厉北辰、苏念）。不要翻译成 'Bei Chen Li'。
- 代词（他/她/它/他们）已被预处理替换为人名，不要再当人物抽取。
- 路人/群众/未具名角色（一个保安、几个客人）不抽。

# 命名禁忌

- 不要用 name / summary / labels / uuid / group_id / attributes / created_at 作为字段名 —— Graphiti 保留字段。
"""
