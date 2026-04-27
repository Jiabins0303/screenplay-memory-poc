from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Organization(BaseModel):
    """组织/公司/机构。

    剧中出现的公司（厉氏集团）、医院、医学世家、势力集团等。
    与 Family 区分：Family=血缘单元；Organization=契约/雇佣/职业单元。
    """

    org_name: str = Field(
        description="组织名，如'厉氏集团'、'仁济医院'",
    )
    org_type: Literal[
        "company", "hospital", "school", "clan_business", "government", "other"
    ] = Field(
        default="company",
        description=(
            "组织类型: company=商业公司; hospital=医院; school=学校; "
            "clan_business=家族企业; government=政府/机关; other=其他"
        ),
    )
