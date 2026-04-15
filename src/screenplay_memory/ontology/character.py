from pydantic import BaseModel, Field


class Character(BaseModel):
    """剧本中的角色实体。

    包括有名字的主角、配角、反派。
    不包括：路人、群众、未具名角色。

    Examples:
        - "李静走进来" → Character(name="李静")
        - "一个路人经过" → 不抽取
    """

    role_type: str = Field(
        default="supporting",
        description=(
            "角色类型。protagonist=主角(故事核心人物)，"
            "antagonist=反派(主要冲突制造者)，"
            "supporting=配角(其他有名字的角色)"
        ),
    )
    identity: str = Field(
        default="",
        description=(
            "角色的简短身份描述。例如'被豪门抛弃的私生女'、"
            "'退伍特种兵'。不要描述外貌或服装。"
        ),
    )
