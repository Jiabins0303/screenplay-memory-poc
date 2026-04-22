"""Chinese extraction instructions injected via Graphiti's source_description.

Graphiti has no first-class `custom_extraction_instructions` parameter, so we
piggy-back on `source_description`, which Graphiti includes in its extraction
prompt. This is a documented community workaround for non-English corpora.
"""

CHINESE_EXTRACTION_INSTRUCTIONS = """这是一段中文剧本文本。请严格遵守以下规则：

1. 所有提取结果必须用中文输出，包括实体名称、关系描述、属性值。
   绝对不要将中文翻译成英文。例如："李静"必须保持为"李静"，
   不要输出"Li Jing"。

2. 重点提取：
   - 有名字的角色（忽略"路人"、"群众"、"那个男人"等无名角色）
   - 关键剧情事件（冲突、揭露、转折、重要决定）
   - 角色之间的明确互动（谁对谁做了什么）
   - 角色获得的新信息（A 告诉 B 某事，B 目睹某事发生）
   - 场次描述（[本段为第X集第Y场] 这种标记应识别为 Scene 实体）

3. 不要提取：
   - 角色的外貌、服装细节
   - 环境描写、天气
   - 角色的纯内心独白（除非有重大转变）
   - 代词（"他"、"她"、"它"、"他们"）不应作为独立实体

4. 关系命名规范（用中文动词短语）：
   - 角色间关系：用"认识"、"恋人"、"敌对"、"家人"等
   - 角色与事件：用"目睹"、"参与"、"导致"、"知道"、"告诉"等

5. 认知归因 witness_scope【关键】：
   每条关系边必须填写 witness_scope（字段见 ScreenplayRelation 模型）。
   - 明确否定：原文若写 "X 不知道 ..."、"X 还不察觉"、"X 殊不知"，
     X 绝不能出现在该事实的 witness_scope 中。
   - 亲历/耳闻：角色 X 说出、听到、目睹、参与此事 → X ∈ witness_scope。
   - 全知叙述：纯叙述者旁白，没有角色亲历 → witness_scope = []。
   - 禁止推理：只取文本字面证据，不要凭常识补全"应当知道"的角色。

6. 指代消解【关键，避免幻觉角色】：
   不要为描述性称谓创建新的 Character 实体。先尝试把它解析到
   已经存在或在前文已经出现的 Character：
   - "30年前送出的女儿"、"她的女儿"、"那个孩子"、"亲生父母"
     等称谓，必须解析为具体角色名（例如"李静"），而不是创建
     名叫"李静的女儿"的新 Character。
   - 跨场景推理时，使用前述剧情（previous_episode）中已建立的
     身份关系。例如：若前文已知"李静被领养"，那么"30年前送出
     的女儿"就是"李静"。
   - 若确实无法确定指代对象，宁可不抽取该关系，也不要发明
     新的人物。
"""

SCENE_HEADER_TEMPLATE = "[本段为第{episode}集第{scene}场]"
