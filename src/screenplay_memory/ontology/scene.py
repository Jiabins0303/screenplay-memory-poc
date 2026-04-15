from pydantic import BaseModel, Field


class Scene(BaseModel):
    """剧本中的一个场次。

    每段 episode 文本会带一个 [本段为第X集第Y场] 头部句子，
    LLM 抽取时会把这个场次描述识别为 Scene 节点。
    """

    episode_number: int = Field(default=0, description="所属集数")
    scene_number: int = Field(default=0, description="本集中的场次号")
    location: str = Field(default="", description="场景发生地点")
