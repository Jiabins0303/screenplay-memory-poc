# Viral Short-Drama Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 3-scene demo (李静/张伟) with a real viral short-drama (《厉总, 你找错夫人了》or 同套路 web-novel) ingested into a new `bazong_demo` project, exercising 10 detail-layer entity types + 3 edge classes + 4 HL entity types, with structured Node/Edge inspectors and Tab-based detail/HL/bridge view switching in the web UI.

**Architecture:** Replace the default ontology entirely (no preset selector). New ontology lives in `src/screenplay_memory/ontology/` (10 entity classes) and `src/screenplay_memory/ontology_hl/` (4 entity classes; `BeatType` extended to 10). Source data is fetched from 番茄小说 (`scripts/fetch_novel.py`, no LLM) then LLM-rewritten into 60 scene files (`scripts/adapt_to_scenes.py`, ~$0.5 once). A new `queries/scene_index.py` builds an inverse index after ingest, writing `scene_appearances` and `quotes` directly onto Neo4j entity/edge properties so the frontend gets all metadata in the existing `/graph` payload. Frontend extends `tokens.css` with 8 new entity colors + dark-mode variants, rewires `ForceGraphPanel.tsx` for edge-aware rendering + click + hover-emoji, replaces `NodeInspector.tsx` with structured display, adds new `EdgeInspector.tsx`, and restructures `Graph.tsx` with 3-tab (detail/HL/bridge) layer switching.

**Tech Stack:** Python 3.11+, Pydantic v2, Graphiti (Neo4j knowledge graph), httpx (novel scraping), pytest (`asyncio_mode=auto` set in pyproject.toml), React 18 + TypeScript + Vite + pnpm, plain Canvas 2D for force graph.

**Spec:** `docs/superpowers/specs/2026-04-25-viral-screenplay-demo-design.md`

---

## Phase 0 — Branch + Worktree (1 task)

### Task 0.1: Cut a feature branch

**Files:** none

- [ ] **Step 1: Create branch from main**

```bash
git switch -c feat/viral-demo
git status
```

Expected: `On branch feat/viral-demo` and clean tree.

- [ ] **Step 2: Confirm baseline tests still pass before any changes**

```bash
docker compose up -d
pytest tests/test_05_customization.py tests/test_05_edits.py -v
```

Expected: customization + edits tests pass (no LLM, fast). Skip the slower test_01-04 because we're about to replace them anyway.

---

## Phase 1 — Detail-Layer Ontology (4 tasks)

### Task 1.1: Test scaffolding for ontology shape (pure Python, no LLM)

**Files:**
- Create: `tests/test_01_ontology.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_01_ontology.py
"""Pure-Python tests for ontology modules. No Neo4j, no LLM, no async."""
from typing import Literal, get_args, get_origin

import pytest

from screenplay_memory.ontology import EDGE_TYPES, ENTITY_TYPES
from screenplay_memory.ontology_hl import HL_ENTITY_TYPES, HL_EDGE_TYPES


EXPECTED_ENTITIES = {
    "Character", "Identity", "Family", "Organization",
    "Item", "Location", "Misunderstanding", "Secret",
    "Scene", "PlotEvent",
}
EXPECTED_EDGES = {"ScreenplayRelation", "BelievesAbout", "KnowsSecret"}
EXPECTED_HL_ENTITIES = {"Beat", "Arc", "Theme", "Trope"}
EXPECTED_BEAT_TYPES = {
    "Hook", "IncitingIncident", "RisingAction", "Midpoint",
    "Climax", "Resolution",
    "CliffHanger", "FacePlay", "Twist", "PayoffMoment",
}
PROTECTED_FIELDS = {
    "name", "summary", "labels", "uuid", "group_id",
    "attributes", "created_at", "name_embedding",
}


def test_entity_types_complete():
    assert set(ENTITY_TYPES.keys()) == EXPECTED_ENTITIES


def test_edge_types_complete():
    assert set(EDGE_TYPES.keys()) == EXPECTED_EDGES


def test_hl_entity_types_complete():
    assert set(HL_ENTITY_TYPES.keys()) == EXPECTED_HL_ENTITIES


def test_no_protected_field_names_used():
    """Graphiti EntityNode protects these names — using them raises EntityTypeValidationError."""
    for cls_name, cls in {**ENTITY_TYPES, **HL_ENTITY_TYPES}.items():
        bad = set(cls.model_fields.keys()) & PROTECTED_FIELDS
        assert not bad, f"{cls_name} uses protected field(s): {bad}"


@pytest.mark.parametrize("cls_name", sorted(EXPECTED_ENTITIES))
def test_entity_fields_use_whitelisted_types(cls_name):
    """Per CLAUDE.md, runtime customization only supports str/int/float/bool/list[str]/list[int]/Literal[...]."""
    cls = ENTITY_TYPES[cls_name]
    for fname, finfo in cls.model_fields.items():
        ann = finfo.annotation
        origin = get_origin(ann)
        if ann in (str, int, float, bool):
            continue
        if origin is Literal:
            continue
        if origin is list:
            inner = get_args(ann)[0]
            assert inner in (str, int), f"{cls_name}.{fname}: list[{inner}] not whitelisted"
            continue
        pytest.fail(f"{cls_name}.{fname}: type {ann!r} not in whitelist")


def test_character_status_tags_field():
    cls = ENTITY_TYPES["Character"]
    assert "status_tags" in cls.model_fields
    assert "role_type" in cls.model_fields
    assert "gender" in cls.model_fields


def test_identity_required_fields():
    cls = ENTITY_TYPES["Identity"]
    for f in ("persona_label", "is_real", "associated_skills"):
        assert f in cls.model_fields


def test_family_required_fields():
    cls = ENTITY_TYPES["Family"]
    for f in ("family_name", "family_alignment", "influence_level"):
        assert f in cls.model_fields


def test_organization_required_fields():
    cls = ENTITY_TYPES["Organization"]
    for f in ("org_name", "org_type"):
        assert f in cls.model_fields


def test_item_required_fields():
    cls = ENTITY_TYPES["Item"]
    for f in ("item_name", "item_role", "significance"):
        assert f in cls.model_fields


def test_location_required_fields():
    cls = ENTITY_TYPES["Location"]
    for f in ("loc_name", "loc_type"):
        assert f in cls.model_fields


def test_misunderstanding_required_fields():
    cls = ENTITY_TYPES["Misunderstanding"]
    for f in ("false_belief", "severity", "is_resolved"):
        assert f in cls.model_fields


def test_secret_required_fields():
    cls = ENTITY_TYPES["Secret"]
    for f in ("secret_content", "secret_type"):
        assert f in cls.model_fields


def test_screenplay_relation_fields():
    cls = EDGE_TYPES["ScreenplayRelation"]
    for f in ("witness_scope", "relation_strength"):
        assert f in cls.model_fields


def test_believes_about_fields():
    cls = EDGE_TYPES["BelievesAbout"]
    for f in ("since_episode", "until_episode", "confidence"):
        assert f in cls.model_fields


def test_knows_secret_fields():
    cls = EDGE_TYPES["KnowsSecret"]
    for f in ("since_episode", "knowledge_source"):
        assert f in cls.model_fields


def test_beat_has_10_types_including_viral():
    cls = HL_ENTITY_TYPES["Beat"]
    bt_field = cls.model_fields["beat_type"]
    assert get_origin(bt_field.annotation) is Literal
    assert set(get_args(bt_field.annotation)) == EXPECTED_BEAT_TYPES


def test_beat_has_audience_emotion():
    cls = HL_ENTITY_TYPES["Beat"]
    assert "audience_emotion" in cls.model_fields


def test_trope_required_fields():
    cls = HL_ENTITY_TYPES["Trope"]
    for f in ("trope_name", "trope_category", "popularity_score"):
        assert f in cls.model_fields
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_01_ontology.py -v`
Expected: ImportError (`Identity` etc. don't exist) — many tests collect-error or fail.

- [ ] **Step 3: No commit yet — implementation in next 3 tasks; we will green Task 1.1's tests over them.**


### Task 1.2: Implement 7 new detail-layer entity classes

**Files:**
- Create: `src/screenplay_memory/ontology/identity.py`
- Create: `src/screenplay_memory/ontology/family.py`
- Create: `src/screenplay_memory/ontology/organization.py`
- Create: `src/screenplay_memory/ontology/item.py`
- Create: `src/screenplay_memory/ontology/location.py`
- Create: `src/screenplay_memory/ontology/misunderstanding.py`
- Create: `src/screenplay_memory/ontology/secret.py`

- [ ] **Step 1: Create identity.py**

```python
# src/screenplay_memory/ontology/identity.py
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
        description="身份的简短标签，如'厉氏集团会计'、'苏家二小姐'、'前任未婚妻'",
    )
    is_real: bool = Field(
        default=False,
        description="True=真实身份；False=伪装/马甲/对外身份",
    )
    associated_skills: list[str] = Field(
        default_factory=list,
        description="此身份带来的关键能力，如['医术','商业谈判','调香']",
    )
```

- [ ] **Step 2: Create family.py**

```python
# src/screenplay_memory/ontology/family.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Family(BaseModel):
    """剧中明确出现的家族单元（厉家、苏家、陆家等）。

    多人通过 MEMBER_OF 边归属同一 Family。临时小队、夫妻俩、合伙关系不抽。
    """

    family_name: str = Field(
        description="家族名，如'厉家'、'苏家'。必须有名字，不要抽'男主家'这种泛指。",
    )
    family_alignment: Literal["protagonist", "antagonist", "neutral"] = Field(
        default="neutral",
        description="protagonist=主角方家族；antagonist=敌对家族；neutral=配角/盟友家族",
    )
    influence_level: int = Field(
        default=3,
        ge=1, le=10,
        description="家族在剧中的影响力 1-10。1=路人家族；10=核心冲突方",
    )
```

- [ ] **Step 3: Create organization.py**

```python
# src/screenplay_memory/ontology/organization.py
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
```

- [ ] **Step 4: Create item.py**

```python
# src/screenplay_memory/ontology/item.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Item(BaseModel):
    """关键道具/信物。

    剧中承载情节意义的物品 —— 揭穿身份的玉佩、证明清白的录音、
    决定遗产的合同等。日常物品（杯子、手机、衣服）不抽取，
    除非它们承担情节作用。

    Examples:
        - "苏念脖子上的玉佩当年是厉北辰送的信物" → Item(item_name="玉佩", item_role="token")
    """

    item_name: str = Field(description="道具名，如'玉佩'、'离婚协议'、'录音笔'")
    item_role: Literal[
        "token", "evidence", "contract", "gift", "heirloom", "weapon", "other"
    ] = Field(
        default="other",
        description=(
            "token=信物/认人；evidence=证据；contract=合同协议；"
            "gift=礼物；heirloom=传家宝；weapon=武器；other=其他"
        ),
    )
    significance: str = Field(
        default="",
        description="此道具的剧情意义，一句话，如'揭穿苏念真实身份的关键信物'",
    )
```

- [ ] **Step 5: Create location.py**

```python
# src/screenplay_memory/ontology/location.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Location(BaseModel):
    """剧中场所。

    至少在 2 个不同 Scene 中出现的物理场所；只出现一次的不抽取。
    场所是物理空间，不是抽象组织（"厉氏集团总部"是 Location；"厉氏集团"是 Organization）。

    Examples:
        - "厉北辰的总裁办公室" → Location(loc_name="厉总办公室", loc_type="office")
        - "苏家祖宅" → Location(loc_name="苏家祖宅", loc_type="mansion")
    """

    loc_name: str = Field(description="场所名，如'厉总办公室'、'苏家祖宅'、'凯悦酒店'")
    loc_type: Literal[
        "office", "home", "mansion", "hotel", "hospital", "restaurant",
        "bar", "outdoor", "school", "prison", "temple", "other"
    ] = Field(
        default="other",
        description=(
            "场所类型: office=办公室; home=普通住宅; mansion=别墅/祖宅; "
            "hotel=酒店; hospital=医院; restaurant=餐厅; bar=酒吧/夜店; "
            "outdoor=户外; school=学校; prison=监狱/拘留所; temple=寺庙; other=其他"
        ),
    )
```

- [ ] **Step 6: Create misunderstanding.py**

```python
# src/screenplay_memory/ontology/misunderstanding.py
from __future__ import annotations

from pydantic import BaseModel, Field


class Misunderstanding(BaseModel):
    """误会 —— 某角色持有的与事实不符的认知。

    误会流短剧的核心实体。仅当原文出现 '误以为/错以为/以为/认为是' 等明确语标时抽。
    通过 BELIEVES_ABOUT 边连接到持有此误会的 Character。

    Examples:
        - "厉北辰一直以为苏念是想攀附豪门的拜金女"
          → Misunderstanding(false_belief="苏念是拜金女")
        - "苏家以为大女儿当年是病死的，殊不知是被害"
          → Misunderstanding(false_belief="苏家大女儿是病死的")
    """

    false_belief: str = Field(
        description="错误认知的一句话陈述，必须是命题（X 是/不是/做了 Y）",
    )
    severity: int = Field(
        default=3, ge=1, le=5,
        description="误会严重程度 1-5。1=小笑话；5=驱动主线冲突的核心误会",
    )
    is_resolved: bool = Field(
        default=False,
        description="此误会在原文范围内是否已被揭穿",
    )
```

- [ ] **Step 7: Create secret.py**

```python
# src/screenplay_memory/ontology/secret.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Secret(BaseModel):
    """秘密 —— 只对部分角色公开的关键信息。

    与 Misunderstanding 互补：Secret 是被隐藏的真相；Misunderstanding 是错误认知。
    通过 KNOWS_SECRET 边连接到知情的 Character。

    Examples:
        - "苏念真实身份是苏家二小姐" → Secret(secret_content="苏念是苏家二小姐", secret_type="identity")
        - "厉北辰当年答应过苏念祖父要保护苏家" → Secret(secret_content="厉北辰对苏家祖父的承诺", secret_type="past_event")
    """

    secret_content: str = Field(description="秘密内容的一句话陈述")
    secret_type: Literal[
        "identity", "past_event", "relationship", "intention", "asset", "other"
    ] = Field(default="other")
```

- [ ] **Step 8: Run lint to catch typos**

Run: `ruff check src/screenplay_memory/ontology/`
Expected: no errors.

(Tests still failing because `__init__.py` not yet updated — Task 1.4 fixes that.)


### Task 1.3: Replace existing detail-layer classes (Character / Scene / PlotEvent / edges)

**Files:**
- Modify: `src/screenplay_memory/ontology/character.py` (full replace)
- Modify: `src/screenplay_memory/ontology/scene.py` (full replace)
- Modify: `src/screenplay_memory/ontology/plot_event.py` (full replace)
- Modify: `src/screenplay_memory/ontology/edges.py` (full replace, adds BelievesAbout + KnowsSecret)

- [ ] **Step 1: Replace character.py**

```python
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
```

- [ ] **Step 2: Replace scene.py** (field names `episode_number` and `location` preserve the existing Cypher contract in `annotations_hl.py` and the JSON shape consumed by `web/src/pages/Graph.tsx`)

```python
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Scene(BaseModel):
    """剧本场次实体。

    每个场次对应一次 add_episode 调用。Scene 的 episode_number/scene_number
    必须从场次头 [本段为第X集第Y场] 抽出来；location 抓场次头里的地点描述。
    """

    episode_number: int = Field(default=0, description="集数, 从场次头 [本段为第X集第Y场] 抽")
    scene_number: int = Field(default=0, description="本集中的场次序号, 从场次头抽")
    location: str = Field(
        default="",
        description="场次头给出的地点描述，如'厉氏集团总裁办公室'、'苏家祖宅'",
    )
    time_of_day: Literal[
        "morning", "afternoon", "evening", "night", "unknown"
    ] = Field(
        default="unknown",
        description="场次时间段；优先取场次头里的明确时间，无则 unknown",
    )
```

- [ ] **Step 3: Replace plot_event.py**

```python
# src/screenplay_memory/ontology/plot_event.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PlotEvent(BaseModel):
    """关键剧情事件。

    可独立成节奏单元的剧情节点。粒度：一场剧通常 0-2 个 PlotEvent，
    不要把每句台词都抽成 event。
    """

    event_summary: str = Field(description="事件的一句话概述，不超过 60 字")
    event_type: Literal[
        "confrontation", "revelation", "decision",
        "transition", "emotional_peak", "other",
    ] = Field(
        default="other",
        description=(
            "confrontation=对峙/冲突；revelation=身份/真相揭穿；"
            "decision=人物做出关键抉择；transition=场景/情节过渡；"
            "emotional_peak=情感高潮（哭/告白/和解）；other=其他"
        ),
    )
```

- [ ] **Step 4: Replace edges.py**

```python
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
```

- [ ] **Step 5: Run lint**

Run: `ruff check src/screenplay_memory/ontology/`
Expected: no errors.


### Task 1.4: Wire detail-layer __init__.py

**Files:**
- Modify: `src/screenplay_memory/ontology/__init__.py` (full replace)

- [ ] **Step 1: Replace __init__.py**

```python
# src/screenplay_memory/ontology/__init__.py
from screenplay_memory.ontology.character import Character
from screenplay_memory.ontology.edges import (
    BelievesAbout,
    KnowsSecret,
    ScreenplayRelation,
)
from screenplay_memory.ontology.family import Family
from screenplay_memory.ontology.identity import Identity
from screenplay_memory.ontology.item import Item
from screenplay_memory.ontology.location import Location
from screenplay_memory.ontology.misunderstanding import Misunderstanding
from screenplay_memory.ontology.organization import Organization
from screenplay_memory.ontology.plot_event import PlotEvent
from screenplay_memory.ontology.scene import Scene
from screenplay_memory.ontology.secret import Secret

ENTITY_TYPES = {
    "Character": Character,
    "Identity": Identity,
    "Family": Family,
    "Organization": Organization,
    "Item": Item,
    "Location": Location,
    "Misunderstanding": Misunderstanding,
    "Secret": Secret,
    "Scene": Scene,
    "PlotEvent": PlotEvent,
}

EDGE_TYPES = {
    "ScreenplayRelation": ScreenplayRelation,
    "BelievesAbout": BelievesAbout,
    "KnowsSecret": KnowsSecret,
}

__all__ = [
    "Character", "Identity", "Family", "Organization", "Item",
    "Location", "Misunderstanding", "Secret", "Scene", "PlotEvent",
    "ScreenplayRelation", "BelievesAbout", "KnowsSecret",
    "ENTITY_TYPES", "EDGE_TYPES",
]
```

- [ ] **Step 2: Run Phase 1 tests — should now mostly pass**

Run: `pytest tests/test_01_ontology.py -v`
Expected: all `test_entity_*`, `test_edge_*`, `test_*_required_fields` pass. The 3 HL tests (`test_hl_entity_types_complete`, `test_beat_*`, `test_trope_*`) still fail — Phase 2 fixes them.

- [ ] **Step 3: Commit Phase 1 detail layer**

```bash
git add src/screenplay_memory/ontology/ tests/test_01_ontology.py
git commit -m "feat(ontology): add 7 new detail-layer entity types + 2 edge classes

Replaces Character.identity:str with a separate Identity node connected via
IS_PERSONA_OF; adds Family, Organization, Item, Location, Misunderstanding,
Secret. Adds BelievesAbout and KnowsSecret edge classes alongside the
existing ScreenplayRelation (now also carries relation_strength 1-5).
witness_scope semantics on ScreenplayRelation unchanged for cognitive
query backward compatibility."
```

---

## Phase 2 — HL-Layer Ontology (2 tasks)

### Task 2.1: Extend Beat to 10 types + add Trope

**Files:**
- Modify: `src/screenplay_memory/ontology_hl/beat.py` (full replace)
- Create: `src/screenplay_memory/ontology_hl/trope.py`

- [ ] **Step 1: Replace beat.py**

```python
# src/screenplay_memory/ontology_hl/beat.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


BeatType = Literal[
    "Hook",
    "IncitingIncident",
    "RisingAction",
    "Midpoint",
    "Climax",
    "Resolution",
    "CliffHanger",
    "FacePlay",
    "Twist",
    "PayoffMoment",
]


class Beat(BaseModel):
    """叙事节拍 —— 全剧层面的结构单元。

    一个节拍覆盖一段连续场次，承载一个重要的叙事功能。短剧爆款常出现
    CliffHanger / FacePlay / Twist / PayoffMoment 这 4 种节拍，密度比传统
    长剧高得多 —— 抽取时不要漏。

    宁可不抽，也不要拼凑：如果某种节拍在剧本里不存在，就不要硬安排。

    Examples:
        - 开场李静和张伟争吵 → Beat(beat_type="Hook")
        - 集末"她竟然是苏家二小姐?" 镜头一黑 → Beat(beat_type="CliffHanger")
        - 受气包当众反击渣前男友 → Beat(beat_type="FacePlay")
        - 误会被揭穿 → Beat(beat_type="Twist")
        - 男主当众宣布女主是他妻子 → Beat(beat_type="PayoffMoment")
    """

    beat_type: BeatType = Field(
        description=(
            "Hook=开场钩子(抓住观众的首个冲突/悬念)；"
            "IncitingIncident=引发事件(打破主角现状)；"
            "RisingAction=主线推进(冲突升级)；"
            "Midpoint=中点逆转(剧情方向扭转)；"
            "Climax=高潮(主要冲突的决定性对抗)；"
            "Resolution=收束(结局与余韵)；"
            "CliffHanger=集末悬念(每集末尾留钩)；"
            "FacePlay=打脸时刻(受气包翻身/反派吃瘪)；"
            "Twist=反转(误会被揭穿/身份大白等)；"
            "PayoffMoment=爽点高潮(观众情绪峰值)"
        ),
    )
    beat_summary: str = Field(
        default="",
        description="该节拍的一句话中文概述，不超过 80 字。只描述剧情功能，不复述台词。",
    )
    scene_range_start: str = Field(
        default="",
        description="该节拍起始场次，格式 '集数-场次'，例如 '1-1'。如果不确定可留空。",
    )
    scene_range_end: str = Field(
        default="",
        description="该节拍结束场次，格式同上。单场节拍时 start 与 end 相同。",
    )
    tension_level: int = Field(
        default=3, ge=1, le=10,
        description="该节拍的戏剧张力 1-10。1=日常铺垫，10=核心高潮。用于 3D 可视化节点大小。",
    )
    involved_characters: list[str] = Field(
        default_factory=list,
        description="该节拍中出现的关键角色中文名列表（与详细层 Character 节点同名）。",
    )
    audience_emotion: Literal[
        "thrill", "satisfaction", "shock", "anger",
        "sweetness", "tension", "tear", "other",
    ] = Field(
        default="other",
        description=(
            "此节拍引发的主导观众情绪：thrill=爽/刺激；satisfaction=满足/解气；"
            "shock=震惊；anger=愤怒/憋屈；sweetness=甜蜜/糖；tension=紧张；"
            "tear=泪点；other=其他"
        ),
    )
```

- [ ] **Step 2: Create trope.py**

```python
# src/screenplay_memory/ontology_hl/trope.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Trope(BaseModel):
    """爆款套路标签 —— 短剧的"配方"标签。

    描述这部剧使用了哪些已被市场验证的爆款套路。每个 Trope 节点是一个套路标签，
    通过 BeatRelation(EMBODIES) 边连到具体的 Beat / Arc / Theme 上。

    抽取范围：抽 5-10 个对全剧最关键的套路即可，不要把每个常见配置都标。

    Examples:
        - 男主是冷面霸总 → Trope(trope_name="霸总人设", trope_category="character")
        - 男女主互相不知道对方真实身份 → Trope(trope_name="双向隐瞒", trope_category="plot")
        - 一夜契约结婚 → Trope(trope_name="契约结婚", trope_category="relationship")
    """

    trope_name: str = Field(
        description=(
            "套路名，常见值：'霸总人设'、'误会流'、'双向隐瞒'、'契约结婚'、"
            "'失忆'、'重生复仇'、'战神归来'、'豪门隐婚'、'灰姑娘逆袭'、"
            "'强势宠婚'、'校园暗恋'、'追妻火葬场'"
        ),
    )
    trope_category: Literal[
        "character", "plot", "relationship", "structure", "other"
    ] = Field(
        default="other",
        description=(
            "character=人物设定类；plot=情节套路；relationship=关系套路；"
            "structure=结构套路；other=其他"
        ),
    )
    popularity_score: int = Field(
        default=5, ge=1, le=10,
        description="此套路在 2024-2026 年短剧市场的流行度 1-10。LLM 自行估算。",
    )
```

- [ ] **Step 3: Run lint**

Run: `ruff check src/screenplay_memory/ontology_hl/`
Expected: no errors.


### Task 2.2: Wire HL __init__.py

**Files:**
- Modify: `src/screenplay_memory/ontology_hl/__init__.py`

- [ ] **Step 1: Replace __init__.py**

```python
# src/screenplay_memory/ontology_hl/__init__.py
"""High-level ("beat") ontology for the second-layer knowledge graph.

Captures narrative shape: 6 classic beats + 4 viral-specific beats
(CliffHanger, FacePlay, Twist, PayoffMoment), plus character Arcs,
Themes, and Tropes (爆款套路标签).
"""

from screenplay_memory.ontology_hl.arc import Arc
from screenplay_memory.ontology_hl.beat import Beat, BeatType
from screenplay_memory.ontology_hl.edges import BeatRelation
from screenplay_memory.ontology_hl.theme import Theme
from screenplay_memory.ontology_hl.trope import Trope

HL_ENTITY_TYPES = {
    "Beat": Beat,
    "Arc": Arc,
    "Theme": Theme,
    "Trope": Trope,
}

HL_EDGE_TYPES = {
    "BeatRelation": BeatRelation,
}

__all__ = [
    "Beat", "BeatType", "Arc", "Theme", "Trope",
    "BeatRelation",
    "HL_ENTITY_TYPES", "HL_EDGE_TYPES",
]
```

- [ ] **Step 2: Run Phase 1 tests — all should now pass**

Run: `pytest tests/test_01_ontology.py -v`
Expected: all 22+ tests pass.

- [ ] **Step 3: Commit Phase 2**

```bash
git add src/screenplay_memory/ontology_hl/
git commit -m "feat(ontology-hl): extend BeatType to 10 viral types + add Trope

BeatType gains CliffHanger / FacePlay / Twist / PayoffMoment alongside
the existing 6-act structural beats. Beat gains audience_emotion field
to tag the dominant viewer reaction. New Trope node (with popularity
score) lets the HL graph surface 爆款配方; Trope→Beat edges reuse
BeatRelation(EMBODIES)."
```

---

## Phase 3 — Prompts Rewrite (2 tasks)

### Task 3.1: Rewrite chinese/prompts.py for new ontology

**Files:**
- Modify: `src/screenplay_memory/chinese/prompts.py`

- [ ] **Step 1: Read current prompts.py**

Run: `cat src/screenplay_memory/chinese/prompts.py`
Expected: see existing CHINESE_EXTRACTION_INSTRUCTIONS string, SCENE_HEADER_TEMPLATE, etc.

- [ ] **Step 2: Replace prompts.py with new instructions covering all 10 entity types and 3 edge classes**

```python
# src/screenplay_memory/chinese/prompts.py
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

2. **Identity** — 角色的某一个身份/马甲/真实身份。一个角色可有多个 Identity。
   字段：persona_label / is_real / associated_skills
   例：'苏念表面是普通会计，真实身份是苏家二小姐'
       → Identity(persona_label='厉氏集团会计', is_real=False)
       → Identity(persona_label='苏家二小姐', is_real=True, associated_skills=['医术'])

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

9. **Scene** — 场次。从场次头 '[本段为第X集第Y场]' 抽 episode/scene_number。
10. **PlotEvent** — 关键剧情事件。一场剧通常 0-2 个，不要把每句台词都抽。

# 边类型

- **ScreenplayRelation**（通用）— 适用于：认识/拥有/工作于/位于/是马甲/是信物/出现于/属于/等。
  字段：witness_scope（认知归因，规则见下）+ relation_strength（1-5）
- **BelievesAbout**（Character → Misunderstanding）— 字段：since_episode / until_episode / confidence
- **KnowsSecret**（Character → Secret）— 字段：since_episode / knowledge_source

# witness_scope 严格规则

【规则 1：明确否定】原文 'X 不知道 Y' / 'X 还未察觉 Y' → X 绝对不进 witness_scope
【规则 2：亲历/耳闻】X 说出/听到/目睹/参与 → X 进 witness_scope
【规则 3：全知叙述】旁白 / '殊不知' / '此时此刻' → witness_scope 留空 []
【规则 4：禁止推理】只依据字面证据，宁可空也不补全

# 角色名规则

- 抽取中文人名（厉北辰、苏念）。不要翻译成 'Bei Chen Li'。
- 代词（他/她/它/他们）已被预处理替换为人名，不要再当人物抽取。
- 路人/群众/未具名角色（一个保安、几个客人）不抽。

# 命名禁忌

- 不要用 name / summary / labels / uuid / group_id / attributes / created_at 作为字段名 —— Graphiti 保留字段。
"""
```

- [ ] **Step 3: Run lint**

Run: `ruff check src/screenplay_memory/chinese/prompts.py`
Expected: no errors.

- [ ] **Step 4: Verify imports still resolve in client.py**

Run: `python -c "from screenplay_memory.chinese.prompts import CHINESE_EXTRACTION_INSTRUCTIONS, SCENE_HEADER_TEMPLATE; print('ok')"`
Expected: prints `ok`.


### Task 3.2: Rewrite chinese/prompts_hl.py

**Files:**
- Modify: `src/screenplay_memory/chinese/prompts_hl.py`

- [ ] **Step 1: Read current prompts_hl.py to preserve any used constants**

Run: `cat src/screenplay_memory/chinese/prompts_hl.py`
Note any constant names referenced from client.py / annotations_hl.py.

- [ ] **Step 2: Replace prompts_hl.py**

```python
# src/screenplay_memory/chinese/prompts_hl.py
"""HL-layer (节拍/弧光/主题/套路) extraction instructions.

Injected into ``MemoryClient.ingest_hl`` as source_description for a
single per-script add_episode call. Whole-script context, so prompt is
larger than the per-scene detail-layer prompt.
"""
from __future__ import annotations

HL_EXTRACTION_INSTRUCTIONS = """\
这是一整部中文短剧的全剧本。请按以下 ontology 抽取节拍 / 弧光 / 主题 / 套路。

# 实体类型

1. **Beat** — 叙事节拍。每个剧本最多每种类型 1 个；如果不存在就别凑。
   字段：beat_type / beat_summary / scene_range_start / scene_range_end
        / tension_level (1-10) / involved_characters / audience_emotion

   beat_type 共 10 种：
   - 经典 6 种：Hook / IncitingIncident / RisingAction / Midpoint / Climax / Resolution
   - 短剧爆款必抽 4 种：
     * **CliffHanger** — 集末留钩（"她竟然是…？" 镜头一黑那种）
     * **FacePlay** — 打脸时刻（受气包翻身/反派吃瘪）
     * **Twist** — 反转（误会被揭穿/身份大白）
     * **PayoffMoment** — 爽点高潮（观众情绪峰值）

2. **Arc** — 角色弧光（某主要角色从 X 到 Y 的转变）。
3. **Theme** — 主题（'家庭责任'、'身份认同'）。
4. **Trope** — 爆款套路标签（'霸总人设'、'误会流'、'双向隐瞒'、'契约结婚' 等）。
   字段：trope_name / trope_category / popularity_score (1-10)
   抽 5-10 个对全剧最关键的套路即可。

# 边类型

- **BeatRelation** — 4 种 relation_type：
  * FOLLOWS — 时间承接 (Hook FOLLOWS IncitingIncident)
  * TRIGGERS — 前者引发后者
  * RESOLVES — 前者收束/化解后者造成的冲突
  * EMBODIES — 前者体现了后者（节拍→主题、节拍→Trope）
  Trope→Beat 边一律用 EMBODIES。

# 严禁

- 不要把"认识/告诉"这类角色细节放到 HL 层 —— 那属于详细层。
- 不要把每集一个节拍硬塞 —— Beat 是全剧结构单元，不是集级单元。
- 不要用 name / summary / labels / uuid / group_id / attributes / created_at 作为字段名。
"""
```

- [ ] **Step 3: Run lint + import check**

Run: `ruff check src/screenplay_memory/chinese/prompts_hl.py && python -c "from screenplay_memory.chinese.prompts_hl import HL_EXTRACTION_INSTRUCTIONS; print('ok')"`
Expected: no errors, prints `ok`.

- [ ] **Step 4: Commit Phase 3**

```bash
git add src/screenplay_memory/chinese/prompts.py src/screenplay_memory/chinese/prompts_hl.py
git commit -m "feat(prompts): rewrite extraction instructions for new ontology

Detail-layer prompt now covers all 10 entity types + 3 edge classes
with concrete 厉总你找错夫人了-style examples. HL prompt covers 10
BeatTypes (incl. viral CliffHanger/FacePlay/Twist/PayoffMoment) plus
Trope tagging. witness_scope rules unchanged."
```

---

## Phase 4 — Source Script Collection (3 tasks, 1 manual review step)

### Task 4.1: Implement scripts/fetch_novel.py (no LLM, $0 cost)

**Files:**
- Create: `scripts/fetch_novel.py`
- Create: `tests/seed_data/source_urls.txt` (placeholder)

- [ ] **Step 1: Create source_urls.txt placeholder**

```
# tests/seed_data/source_urls.txt
# Add 10-15 番茄小说 chapter URLs here, one per line.
# Lines starting with # are ignored.
# Example:
# https://fanqienovel.com/page/7XXXXXXXXX
```

- [ ] **Step 2: Write fetch_novel.py**

```python
#!/usr/bin/env python3
# scripts/fetch_novel.py
"""Fetch chapters from 番茄小说 into tests/seed_data/raw/.

Usage:
    python scripts/fetch_novel.py

Reads URLs from tests/seed_data/source_urls.txt. Writes one
chapter_{N}.txt file per URL. No LLM calls — pure HTTP + HTML parsing.

The 番茄 chapter HTML structure is stable enough that a single CSS
selector ('.muye-reader-content') gives the body. If the selector breaks,
adjust ARTICLE_SELECTOR.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import httpx
from selectolax.parser import HTMLParser


ROOT = Path(__file__).resolve().parent.parent
URLS_PATH = ROOT / "tests" / "seed_data" / "source_urls.txt"
RAW_DIR = ROOT / "tests" / "seed_data" / "raw"

ARTICLE_SELECTOR = ".muye-reader-content"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
}


def parse_chapter(html: str) -> str:
    tree = HTMLParser(html)
    node = tree.css_first(ARTICLE_SELECTOR)
    if node is None:
        raise RuntimeError(
            f"selector {ARTICLE_SELECTOR!r} matched nothing — page structure may have changed"
        )
    text = node.text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main() -> int:
    if not URLS_PATH.exists():
        print(f"missing {URLS_PATH}", file=sys.stderr)
        return 1

    urls = [
        line.strip()
        for line in URLS_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if not urls:
        print(f"no URLs in {URLS_PATH}", file=sys.stderr)
        return 1

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    with httpx.Client(headers=HEADERS, timeout=30.0, follow_redirects=True) as client:
        for i, url in enumerate(urls, 1):
            print(f"[{i}/{len(urls)}] {url}")
            r = client.get(url)
            r.raise_for_status()
            try:
                text = parse_chapter(r.text)
            except RuntimeError as e:
                print(f"  ERROR: {e}", file=sys.stderr)
                continue
            outpath = RAW_DIR / f"chapter_{i:02d}.txt"
            outpath.write_text(text, encoding="utf-8")
            print(f"  -> {outpath} ({len(text)} chars)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Add selectolax + httpx to dev deps if missing**

Run: `pip install selectolax httpx`
Then check pyproject.toml — if `selectolax` not listed, add to `[project.optional-dependencies].dev`.

- [ ] **Step 4: Manual: choose & populate URLs**

Open `tests/seed_data/source_urls.txt` in editor. Search 番茄小说 for 《厉总,你找错夫人了》 or 《闪婚后,亿万总裁马甲藏不住了》. Pick 10-15 consecutive chapter URLs covering the first 1/3 of the book. Paste into the file.

- [ ] **Step 5: Run fetch script**

Run: `python scripts/fetch_novel.py`
Expected: `tests/seed_data/raw/chapter_01.txt` ... `chapter_15.txt` written. Each ~1500-3000 字.

- [ ] **Step 6: Sanity-check output**

Run: `wc -c tests/seed_data/raw/chapter_*.txt | tail -5`
Expected: each file > 1000 bytes; total ~30-50KB.

- [ ] **Step 7: Commit fetch_novel.py + URL list (NOT the raw chapters)**

Add `tests/seed_data/raw/` to `.gitignore` first since chapters are derived data:

```bash
echo "tests/seed_data/raw/" >> .gitignore
git add .gitignore scripts/fetch_novel.py tests/seed_data/source_urls.txt pyproject.toml
git commit -m "feat(scripts): add fetch_novel.py for 番茄小说 chapter scraping"
```


### Task 4.2: Implement scripts/adapt_to_scenes.py (LLM, ~$0.5)

**Files:**
- Create: `scripts/adapt_to_scenes.py`

- [ ] **Step 1: Write adapt_to_scenes.py**

```python
#!/usr/bin/env python3
# scripts/adapt_to_scenes.py
"""Convert raw novel chapters into 短剧 scene files.

Usage:
    python scripts/adapt_to_scenes.py        # convert all
    python scripts/adapt_to_scenes.py --dry  # estimate cost only

Reads tests/seed_data/raw/chapter_NN.txt; writes
tests/seed_data/scenes/ep{E}_sc{S}.txt one per scene.

Roughly maps 1 chapter → 1 episode (4-6 scenes). Cost: ~$0.05 per chapter
on Qwen2.5-72b. ~$0.5 total for 10-15 chapters.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from pathlib import Path

from openai import AsyncOpenAI

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "tests" / "seed_data" / "raw"
SCENES_DIR = ROOT / "tests" / "seed_data" / "scenes"


SYSTEM_PROMPT = """你是中文短剧编剧。将给定的小说章节改写成 4-6 场短剧场次。

# 输出格式（每场严格遵守）

【第{N}集第{M}场】场景：{地点} / 时间：{白天|夜晚|清晨|傍晚}

[场景动作描述，括号内]

人名甲：「台词」
人名乙：「台词」
人名甲：「台词」（动作描述）

# 改写规则

1. 每场 200-400 字，包含 5-15 句对白 + 必要动作描述。
2. **保留小说中所有以下元素**（用于知识图谱抽取）：
   - 角色的双重身份（公开身份 vs 真实身份）
   - 误会（"X 误以为 Y 是 Z"）
   - 关键道具（玉佩、合同、信物）
   - 家族关系（厉家、苏家）
   - 秘密（未公开的真相）
3. 不引入小说中没有的角色或情节。
4. 不要用 "他/她/它/他们" 模糊代词，全部展开成人名。
5. 同一角色名全文保持一致拼写。
6. 节奏特征：每集结尾留一个 CliffHanger（悬念或反转），尽量包含一个 FacePlay（打脸瞬间）。

# 集数 / 场次约定

输入是第 {chapter_num} 章，请改写为第 {chapter_num} 集，场次从 1 开始顺序编号。
"""


async def adapt_chapter(
    client: AsyncOpenAI, model: str, chapter_num: int, chapter_text: str
) -> str:
    user_prompt = (
        f"输入：第 {chapter_num} 章原文（{len(chapter_text)} 字）：\n\n"
        f"---\n{chapter_text}\n---\n\n"
        f"请改写为第 {chapter_num} 集的 4-6 场短剧场次。"
    )
    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.format(chapter_num=chapter_num)},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
    )
    return resp.choices[0].message.content or ""


SCENE_HEADER_RE = re.compile(r"【第(\d+)集第(\d+)场】")


def split_scenes(content: str) -> list[tuple[int, int, str]]:
    """Split a full chapter response into individual (episode, scene, text) tuples."""
    parts = SCENE_HEADER_RE.split(content)
    # parts = [pre, ep1, sc1, body1, ep2, sc2, body2, ...]
    out: list[tuple[int, int, str]] = []
    for i in range(1, len(parts) - 2, 3):
        ep = int(parts[i])
        sc = int(parts[i + 1])
        body = parts[i + 2].strip()
        # rebuild header so the saved file is self-contained
        full = f"【第{ep}集第{sc}场】{body}"
        out.append((ep, sc, full))
    return out


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true", help="estimate cost, don't call LLM")
    args = parser.parse_args()

    api_key = os.getenv("OPENROUTER_API_KEY")
    base_url = os.getenv("OPENROUTER_API_BASE", "https://openrouter.ai/api/v1")
    model = os.getenv("CHAT_MODEL", "qwen/qwen-2.5-72b-instruct")
    if not api_key and not args.dry:
        print("OPENROUTER_API_KEY not set", file=sys.stderr)
        return 1

    chapters = sorted(RAW_DIR.glob("chapter_*.txt"))
    if not chapters:
        print(f"no chapters in {RAW_DIR}", file=sys.stderr)
        return 1

    total_chars = sum(p.stat().st_size for p in chapters)
    estimated_cost = total_chars / 1000 * 0.005  # rough Qwen2.5-72b est, ¥/$ mix
    print(f"chapters: {len(chapters)}, total ~{total_chars} chars, est. ${estimated_cost:.2f}")
    if args.dry:
        return 0

    SCENES_DIR.mkdir(parents=True, exist_ok=True)

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    for path in chapters:
        m = re.search(r"chapter_(\d+)", path.stem)
        if not m:
            continue
        chap_num = int(m.group(1))
        text = path.read_text(encoding="utf-8")
        print(f"adapting chapter {chap_num} ({len(text)} chars)...")
        result = await adapt_chapter(client, model, chap_num, text)
        scenes = split_scenes(result)
        if not scenes:
            print(f"  WARN: no scenes parsed; raw response saved")
            (SCENES_DIR / f"ep{chap_num:02d}_RAW.txt").write_text(result, encoding="utf-8")
            continue
        for ep, sc, body in scenes:
            out = SCENES_DIR / f"ep{ep:02d}_sc{sc:02d}.txt"
            out.write_text(body, encoding="utf-8")
            print(f"  -> {out}")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 2: Dry-run cost estimate**

Run: `python scripts/adapt_to_scenes.py --dry`
Expected: prints chapter count + cost estimate, no API call.

- [ ] **Step 3: Run live (this costs ~$0.5)**

Run: `python scripts/adapt_to_scenes.py`
Expected: writes ~50-70 files into `tests/seed_data/scenes/ep{NN}_sc{NN}.txt`.

- [ ] **Step 4: Sanity check output**

Run: `ls tests/seed_data/scenes/ | head -20 && wc -l tests/seed_data/scenes/*.txt | tail -3`
Expected: ~50-70 scene files, each 8-30 lines.

- [ ] **Step 5: Commit script + scenes (commit scenes since they're the actual demo data, kept stable)**

```bash
git add scripts/adapt_to_scenes.py tests/seed_data/scenes/
git commit -m "feat(scripts): add adapt_to_scenes.py and 60 generated scene files"
```


### Task 4.3: Manual review of generated scenes (no code)

**Files:**
- Modify (manually): `tests/seed_data/scenes/*.txt` as needed

- [ ] **Step 1: Open `tests/seed_data/scenes/ep01_sc01.txt` through `ep03_sc06.txt`**

Read each. Confirm:
- Character names consistent (no 苏念 / 苏年 mixing)
- At least 1 Identity hint in first 3 episodes ("真实身份"、"其实是")
- At least 1 Misunderstanding hint ("误以为"、"以为是"、"错以为")
- At least 1 Item with significance ("玉佩是当年的信物")
- At least 1 explicit Family reference ("厉家"、"苏家")
- At least 1 Location used multiple times

- [ ] **Step 2: Edit any scene file to inject missing types**

If e.g. ep02_sc03 doesn't mention any 误会 but the source novel has one, manually rewrite that scene to include "厉北辰心想：'这个女人肯定是冲着我的钱来的。'"

- [ ] **Step 3: Commit edits if any**

```bash
git diff --stat tests/seed_data/scenes/
git add tests/seed_data/scenes/
git commit -m "data: hand-edit scenes to ensure each entity type has training samples"
```

(Skip the commit if no diffs.)

---

## Phase 5 — Inverse Index (3 tasks)

### Task 5.1: Test scaffolding for scene index (Cypher only, no LLM)

**Files:**
- Create: `tests/test_07_scene_index.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_07_scene_index.py
"""Verify the scene inverse index post-step writes scene_appearances/quotes
onto entity nodes and edges by setting up a minimal hand-built graph.

Pure Neo4j (no LLM); requires docker compose up -d.
"""
from __future__ import annotations

import pytest
from neo4j import AsyncGraphDatabase

from screenplay_memory.config import Settings
from screenplay_memory.queries.scene_index import build_scene_index


@pytest.fixture
async def driver():
    s = Settings.from_env()
    drv = AsyncGraphDatabase.driver(s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password))
    yield drv
    await drv.close()


@pytest.fixture
async def fixture_graph(driver):
    """Build a tiny graph: 2 Episodic, 2 Scene, 1 Character, 1 edge."""
    gid = "test_scene_index"
    async with driver.session() as s:
        await s.run("MATCH (n) WHERE n.group_id=$gid DETACH DELETE n", gid=gid)
        await s.run(
            """
            CREATE (e1:Episodic {uuid:'e1', group_id:$gid, episode_num:1, scene_num:1})
            CREATE (e2:Episodic {uuid:'e2', group_id:$gid, episode_num:1, scene_num:2})
            CREATE (s1:Scene   {uuid:'s1', group_id:$gid, episode_number:1, scene_number:1, name:'第1集第1场'})
            CREATE (s2:Scene   {uuid:'s2', group_id:$gid, episode_number:1, scene_number:2, name:'第1集第2场'})
            CREATE (c1:Character {uuid:'c1', group_id:$gid, name:'苏念', episodes:['e1','e2']})
            CREATE (c2:Character {uuid:'c2', group_id:$gid, name:'厉北辰', episodes:['e1']})
            CREATE (c1)-[r:KNOWS {uuid:'r1', group_id:$gid, episodes:['e1']}]->(c2)
            """,
            gid=gid,
        )
    yield gid
    async with driver.session() as s:
        await s.run("MATCH (n) WHERE n.group_id=$gid DETACH DELETE n", gid=gid)


async def test_episodic_to_scene_link_built(driver, fixture_graph):
    await build_scene_index(driver, group_id=fixture_graph)
    async with driver.session() as s:
        r = await s.run(
            "MATCH (e:Episodic {uuid:'e1'})-[:OF_SCENE]->(s:Scene) "
            "WHERE e.group_id=$gid RETURN s.uuid AS sid",
            gid=fixture_graph,
        )
        record = await r.single()
        assert record is not None
        assert record["sid"] == "s1"


async def test_node_scene_appearances_written(driver, fixture_graph):
    await build_scene_index(driver, group_id=fixture_graph)
    async with driver.session() as s:
        r = await s.run(
            "MATCH (c:Character {uuid:'c1'}) WHERE c.group_id=$gid "
            "RETURN c.scene_appearances AS sa",
            gid=fixture_graph,
        )
        record = await r.single()
        sa = record["sa"]
        assert set(sa) == {"s1", "s2"}


async def test_edge_scene_appearances_written(driver, fixture_graph):
    await build_scene_index(driver, group_id=fixture_graph)
    async with driver.session() as s:
        r = await s.run(
            "MATCH (a)-[r:KNOWS {uuid:'r1'}]->(b) WHERE r.group_id=$gid "
            "RETURN r.scene_appearances AS sa",
            gid=fixture_graph,
        )
        record = await r.single()
        sa = record["sa"]
        assert set(sa) == {"s1"}


async def test_idempotent(driver, fixture_graph):
    """Running twice produces the same result (no duplicate OF_SCENE edges)."""
    await build_scene_index(driver, group_id=fixture_graph)
    await build_scene_index(driver, group_id=fixture_graph)
    async with driver.session() as s:
        r = await s.run(
            "MATCH (e:Episodic)-[r:OF_SCENE]->(s:Scene) "
            "WHERE e.group_id=$gid RETURN count(r) AS n",
            gid=fixture_graph,
        )
        record = await r.single()
        assert record["n"] == 2
```

- [ ] **Step 2: Run tests — should fail**

Run: `pytest tests/test_07_scene_index.py -v`
Expected: ImportError (`build_scene_index` doesn't exist).


### Task 5.2: Implement queries/scene_index.py

**Files:**
- Create: `src/screenplay_memory/queries/scene_index.py`

- [ ] **Step 1: Write the module**

```python
# src/screenplay_memory/queries/scene_index.py
"""Build inverse index from entities/edges back to source Scenes.

Graphiti stores `episodes: list[str]` on each EntityNode and EntityEdge —
the list of Episodic UUIDs the item was extracted from. We call
`add_episode` once per scene, so an Episodic node corresponds 1:1 to a
Scene we extracted. This module:

  1. Builds Episodic → Scene `:OF_SCENE` edges by matching on
     (episode_num, scene_num) properties (set on Episodic by client.py
     via reference_time decoding) against (episode, scene_number) on the
     extracted Scene entity.
  2. Writes `scene_appearances: list[str]` (Scene UUIDs) onto every
     non-Scene, non-Episodic node within a group_id.
  3. Writes `scene_appearances: list[str]` onto every edge that has a
     non-empty `episodes` list.
  4. Writes `quotes: list[str]` onto edges (JSON-serialized list of
     {scene_uuid, snippet} dicts), grabbing ±50 chars around the source/
     target node names from each Episodic's content. Capped at 3 quotes/edge.

After ingest, call `build_scene_index(driver, group_id=...)` once.
Idempotent — safe to call multiple times.
"""
from __future__ import annotations

import json
from typing import Any

from neo4j import AsyncDriver


async def build_scene_index(driver: AsyncDriver, group_id: str) -> dict[str, int]:
    """Run all 4 index passes for a project. Returns counts for telemetry."""
    counts: dict[str, int] = {}
    async with driver.session() as sess:
        counts["of_scene_edges"] = await _link_episodic_to_scene(sess, group_id)
        counts["nodes_indexed"] = await _index_node_appearances(sess, group_id)
        counts["edges_indexed"] = await _index_edge_appearances(sess, group_id)
        counts["edge_quotes_written"] = await _write_edge_quotes(sess, group_id)
    return counts


async def _link_episodic_to_scene(sess, gid: str) -> int:
    """Build (Episodic)-[:OF_SCENE]->(Scene) edges."""
    result = await sess.run(
        """
        MATCH (e:Episodic) WHERE e.group_id=$gid
        MATCH (s:Scene) WHERE s.group_id=$gid
            AND s.episode_number = e.episode_num
            AND s.scene_number = e.scene_num
        MERGE (e)-[r:OF_SCENE]->(s)
        RETURN count(r) AS n
        """,
        gid=gid,
    )
    rec = await result.single()
    return rec["n"] if rec else 0


async def _index_node_appearances(sess, gid: str) -> int:
    result = await sess.run(
        """
        MATCH (n) WHERE n.group_id=$gid
            AND NOT 'Scene' IN labels(n)
            AND NOT 'Episodic' IN labels(n)
            AND n.episodes IS NOT NULL
        OPTIONAL MATCH (e:Episodic)-[:OF_SCENE]->(s:Scene)
            WHERE e.uuid IN n.episodes
        WITH n, collect(DISTINCT s.uuid) AS sids
        SET n.scene_appearances = sids
        RETURN count(n) AS n
        """,
        gid=gid,
    )
    rec = await result.single()
    return rec["n"] if rec else 0


async def _index_edge_appearances(sess, gid: str) -> int:
    result = await sess.run(
        """
        MATCH (a)-[r]->(b) WHERE r.group_id=$gid
            AND r.episodes IS NOT NULL
        OPTIONAL MATCH (e:Episodic)-[:OF_SCENE]->(s:Scene)
            WHERE e.uuid IN r.episodes
        WITH r, collect(DISTINCT s.uuid) AS sids
        SET r.scene_appearances = sids
        RETURN count(r) AS n
        """,
        gid=gid,
    )
    rec = await result.single()
    return rec["n"] if rec else 0


async def _write_edge_quotes(sess, gid: str) -> int:
    """Pull source-text snippets ±50 chars around source/target names per edge."""
    result = await sess.run(
        """
        MATCH (a)-[r]->(b) WHERE r.group_id=$gid
            AND r.episodes IS NOT NULL
        WITH a, b, r, r.episodes[0..3] AS epis
        UNWIND epis AS eu
        MATCH (e:Episodic {uuid:eu})-[:OF_SCENE]->(s:Scene)
        RETURN r.uuid AS rid, a.name AS aname, b.name AS bname,
               s.uuid AS sid, e.content AS content
        """,
        gid=gid,
    )
    by_edge: dict[str, list[dict[str, Any]]] = {}
    async for row in result:
        rid = row["rid"]
        if not rid or not row["content"]:
            continue
        snippet = _extract_around(row["content"], row["aname"], row["bname"])
        if snippet:
            by_edge.setdefault(rid, []).append({"scene_uuid": row["sid"], "snippet": snippet})

    n_written = 0
    for rid, quotes in by_edge.items():
        await sess.run(
            "MATCH ()-[r {uuid:$rid}]->() SET r.quotes = $q",
            rid=rid,
            q=json.dumps(quotes[:3], ensure_ascii=False),
        )
        n_written += 1
    return n_written


def _extract_around(content: str, *names: str | None) -> str:
    """Return ±50-char snippet around the first name found; '' if none found."""
    for name in names:
        if not name:
            continue
        idx = content.find(name)
        if idx >= 0:
            start = max(0, idx - 50)
            end = min(len(content), idx + len(name) + 50)
            snippet = content[start:end].replace("\n", " ").strip()
            return snippet
    return ""
```

- [ ] **Step 2: Run Task 5.1 tests — should pass**

Run: `pytest tests/test_07_scene_index.py -v`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/screenplay_memory/queries/scene_index.py tests/test_07_scene_index.py
git commit -m "feat(queries): add scene_index inverse index for node/edge metadata

Builds Episodic-[:OF_SCENE]->Scene bridge then writes scene_appearances
arrays and quote snippets onto entity nodes and edges so the frontend's
NodeInspector/EdgeInspector can show 'appears in S01E01...' and
±50-char source-text excerpts without extra Cypher per inspector open."
```


### Task 5.3: Patch client.py to set Episodic episode_num/scene_num

**Files:**
- Modify: `src/screenplay_memory/client.py` (where `add_episode` is called)

- [ ] **Step 1: Read current client.py to find the add_episode call**

Run: `grep -n add_episode src/screenplay_memory/client.py`
Expected: 1-2 hits. Note line numbers.

- [ ] **Step 2: After each add_episode, write episode_num/scene_num properties on the new Episodic node**

After the `await self._graphiti.add_episode(...)` call inside `ingest()`, add:

```python
# Tag this Episodic with episode/scene metadata so the inverse-index
# scene_index module can link it back to the extracted Scene node.
async with self._graphiti.driver.session() as sess:
    await sess.run(
        """
        MATCH (e:Episodic)
        WHERE e.group_id=$gid AND e.reference_time=$rt
        SET e.episode_num=$ep, e.scene_num=$sc
        """,
        gid=self._project_id,
        rt=reference_time,
        ep=episode,
        sc=scene,
    )
```

(Replace `episode`, `scene`, `reference_time` with the existing variable names in client.py — they will be set just before the add_episode call.)

- [ ] **Step 3: Verify imports / types still resolve**

Run: `python -c "from screenplay_memory.client import MemoryClient; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/screenplay_memory/client.py
git commit -m "feat(client): tag Episodic nodes with episode_num/scene_num for inverse index"
```

---

## Phase 6 — Ingest + Build Index (1 task, no auto-tests; cost ~$3)

### Task 6.1: Ingest 60 scenes into bazong_demo + build index

**Files:**
- Create: `scripts/build_scene_index.py`
- Create: `scripts/populate_bazong_demo.py`

- [ ] **Step 1: Create build_scene_index.py wrapper**

```python
#!/usr/bin/env python3
# scripts/build_scene_index.py
"""Run inverse-index build for a project. Standalone entrypoint.

Usage:
    python scripts/build_scene_index.py --project-id bazong_demo
    python scripts/build_scene_index.py --project-id bazong_demo --layer hl
"""
from __future__ import annotations

import argparse
import asyncio

from neo4j import AsyncGraphDatabase

from screenplay_memory.config import Settings
from screenplay_memory.queries.scene_index import build_scene_index


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--layer", choices=["detail", "hl"], default="detail")
    args = parser.parse_args()

    s = Settings.from_env()
    driver = AsyncGraphDatabase.driver(s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password))
    try:
        gid = args.project_id if args.layer == "detail" else f"{args.project_id}__hl"
        counts = await build_scene_index(driver, group_id=gid)
        print(f"index built for {gid}: {counts}")
    finally:
        await driver.close()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Create populate_bazong_demo.py — full ingest pipeline**

```python
#!/usr/bin/env python3
# scripts/populate_bazong_demo.py
"""End-to-end ingest of tests/seed_data/scenes/ into the bazong_demo project.

Usage:
    python scripts/populate_bazong_demo.py [--clear-first]

Steps:
    1. (optional) clear bazong_demo group_id
    2. for each ep{NN}_sc{NN}.txt: client.ingest(text)
    3. concat all scenes; client.ingest_hl(scenes)
    4. attach_beats_to_scenes() bridge
    5. build_scene_index(detail) + build_scene_index(hl)
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

from neo4j import AsyncGraphDatabase

from screenplay_memory.client import MemoryClient
from screenplay_memory.config import Settings
from screenplay_memory.queries.scene_index import build_scene_index

ROOT = Path(__file__).resolve().parent.parent
SCENES_DIR = ROOT / "tests" / "seed_data" / "scenes"
SCENE_RE = re.compile(r"ep(\d+)_sc(\d+)\.txt$")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clear-first", action="store_true")
    parser.add_argument("--project-id", default="bazong_demo")
    args = parser.parse_args()

    files = sorted(SCENES_DIR.glob("ep*_sc*.txt"))
    if not files:
        print(f"no scenes in {SCENES_DIR}", file=sys.stderr)
        return 1

    mc = MemoryClient(project_id=args.project_id)
    try:
        if args.clear_first:
            await mc.clear()
            print("cleared previous data")

        # 1. Detail-layer ingest, scene by scene
        for path in files:
            m = SCENE_RE.search(path.name)
            if not m:
                continue
            ep, sc = int(m.group(1)), int(m.group(2))
            text = path.read_text(encoding="utf-8")
            print(f"ingest ep{ep:02d}_sc{sc:02d} ({len(text)} chars)")
            await mc.ingest(text, episode=ep, scene=sc)

        # 2. HL-layer ingest, full script in one episode
        full = "\n\n".join(p.read_text(encoding="utf-8") for p in files)
        print(f"ingest HL ({len(full)} chars)")
        await mc.ingest_hl(full)

        # 3. Bridge edges
        await mc.attach_beats_to_scenes()
        print("bridge edges attached")

    finally:
        await mc.close()

    # 4. Inverse index
    s = Settings.from_env()
    driver = AsyncGraphDatabase.driver(s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password))
    try:
        for layer_gid in (args.project_id, f"{args.project_id}__hl"):
            counts = await build_scene_index(driver, group_id=layer_gid)
            print(f"index {layer_gid}: {counts}")
    finally:
        await driver.close()

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 3: Verify env**

Run: `cat .env | grep -E '^(OPENROUTER|CHAT_MODEL|NEO4J)'`
Expected: OPENROUTER_API_KEY, CHAT_MODEL, NEO4J_URI/USER/PASSWORD all set.

Run: `docker compose ps neo4j`
Expected: neo4j running.

- [ ] **Step 4: Run ingest (this costs ~$3 and takes 10-20 min)**

Run: `python scripts/populate_bazong_demo.py --clear-first`
Expected: prints scene-by-scene ingest progress, then HL ingest, then bridge, then index counts.

- [ ] **Step 5: Spot-check Neo4j Browser**

Open http://localhost:7474 (neo4j / testpassword). Run:

```cypher
MATCH (n) WHERE n.group_id='bazong_demo' RETURN labels(n)[1] AS label, count(*) AS n
ORDER BY n DESC
```

Expected: see Character, Identity, Family, Organization, Item, Location, Misunderstanding, Secret, Scene, PlotEvent each with > 0 nodes. Character > 5, Scene > 30.

```cypher
MATCH (n) WHERE n.group_id='bazong_demo' AND n.scene_appearances IS NOT NULL
RETURN labels(n)[1] AS label, n.name AS name, n.scene_appearances AS scenes LIMIT 10
```

Expected: each entity has a non-empty scene_appearances array.

- [ ] **Step 6: Commit scripts (NOT data — Neo4j volume not in git)**

```bash
git add scripts/build_scene_index.py scripts/populate_bazong_demo.py
git commit -m "feat(scripts): bazong_demo end-to-end ingest pipeline"
```

---

## Phase 7 — Refresh Existing Tests (5 tasks)

For each rewritten test, the goal is "exercise the new ontology against a small subset of seed data, no full ingest."

### Task 7.1: Rewrite test_01_baseline.py

(test_01 was rewritten as test_01_ontology.py in Phase 1; the OLD test_01_baseline.py file still needs deletion.)

**Files:**
- Delete: `tests/test_01_baseline.py` (old)

- [ ] **Step 1: Verify Phase 1's test_01_ontology.py exists**

Run: `ls tests/test_01_ontology.py`
Expected: file exists.

- [ ] **Step 2: Delete the old baseline test**

Run: `git rm tests/test_01_baseline.py`

- [ ] **Step 3: Commit**

```bash
git commit -m "test: delete obsolete test_01_baseline.py (replaced by test_01_ontology.py)"
```


### Task 7.2: Rewrite test_02_ontology.py (LLM-backed, slow)

**Files:**
- Modify: `tests/test_02_ontology.py` (full rewrite)

- [ ] **Step 1: Replace with new test**

```python
# tests/test_02_ontology.py
"""LLM-backed integration test — ingest 1 scene, verify ≥1 of each new entity type extracted.

Uses a hand-crafted scene packed with all 7 new entity types. Slow (~$0.10 per run).
"""
from __future__ import annotations

import pytest

from screenplay_memory.client import MemoryClient


PACKED_SCENE = """\
【第1集第1场】场景：厉氏集团总裁办公室 / 时间：上午

[厉北辰坐在办公桌前，翻看苏念的资料。林秘书站在一旁。]

厉北辰：「这就是新来的会计苏念？背景调查做了吗？」（手指轻敲桌面）
林秘书：「做了，厉总。她父母双亡，目前住在合租公寓。背景干净。」
厉北辰：「干净？」（冷笑）「她肯定是冲着厉家的钱来的。这种女人我见多了。」

[厉北辰拿起桌上的玉佩，是当年他从一个小女孩手里抢救下来的信物。]

厉北辰：「林秘书，安排她明天到我办公室。我倒要看看，这个'拜金女'葫芦里卖什么药。」

[镜头切到苏念。她在自己的小公寓里，对着一张老照片轻声说话。]

苏念：「爷爷，您放心，我一定会查清楚当年苏家二小姐失踪的真相。」

[镜头给到苏念脖子上挂着的同款玉佩，特写。她其实就是苏家二小姐，但厉北辰不知道。]
"""


@pytest.fixture
async def project():
    mc = MemoryClient(project_id="test_02_packed")
    await mc.clear()
    yield mc
    await mc.clear()
    await mc.close()


async def test_packed_scene_yields_each_entity_type(project):
    await project.ingest(PACKED_SCENE, episode=1, scene=1)
    async with project._graphiti.driver.session() as sess:
        r = await sess.run(
            "MATCH (n) WHERE n.group_id=$gid AND NOT 'Episodic' IN labels(n) "
            "RETURN DISTINCT labels(n)[1] AS lbl",
            gid="test_02_packed",
        )
        labels = {row["lbl"] async for row in r}

    # Hard requirements: these must be extracted from this scene
    assert "Character" in labels, "missing Character"
    assert "Identity" in labels, "missing Identity (苏家二小姐 vs 会计)"
    assert "Item" in labels, "missing Item (玉佩)"
    assert "Misunderstanding" in labels, "missing Misunderstanding (拜金女)"

    # Softer requirements: these are likely but not guaranteed in 1 scene
    likely = {"Family", "Organization", "Location", "Secret", "Scene"}
    found_likely = labels & likely
    assert len(found_likely) >= 3, f"expected ≥3 of {likely}, got {found_likely}"
```

- [ ] **Step 2: Ensure docker is up; ensure prior bazong_demo isn't conflicting**

Run: `docker compose ps neo4j`
Expected: running.

- [ ] **Step 3: Run test (~$0.10, ~60s)**

Run: `pytest tests/test_02_ontology.py -v`
Expected: pass.

If Identity or Misunderstanding missing: open `chinese/prompts.py` and beef up that entity's example block, then re-run.

- [ ] **Step 4: Commit**

```bash
git add tests/test_02_ontology.py
git commit -m "test: rewrite test_02_ontology against new 10-entity ontology"
```


### Task 7.3: Rewrite test_03_query.py

**Files:**
- Modify: `tests/test_03_query.py` (full rewrite)

- [ ] **Step 1: Replace test**

```python
# tests/test_03_query.py
"""Cognitive query smoke test against bazong_demo (run populate first).

This test assumes scripts/populate_bazong_demo.py has run successfully.
It does not re-ingest. If bazong_demo is empty, the test skips.
"""
from __future__ import annotations

import pytest

from screenplay_memory.client import MemoryClient


@pytest.fixture
async def client():
    mc = MemoryClient(project_id="bazong_demo")
    yield mc
    await mc.close()


async def _has_data(mc) -> bool:
    async with mc._graphiti.driver.session() as s:
        r = await s.run(
            "MATCH (c:Character) WHERE c.group_id='bazong_demo' RETURN count(c) AS n"
        )
        rec = await r.single()
        return (rec["n"] if rec else 0) > 0


async def test_protagonist_knows_at_least_some_facts(client):
    if not await _has_data(client):
        pytest.skip("bazong_demo not populated; run scripts/populate_bazong_demo.py first")

    # Use whatever main protagonist name actually got extracted
    async with client._graphiti.driver.session() as s:
        r = await s.run(
            "MATCH (c:Character) WHERE c.group_id='bazong_demo' AND c.role_type='protagonist' "
            "RETURN c.name AS name LIMIT 1"
        )
        rec = await r.single()
        if not rec:
            pytest.skip("no protagonist Character found")
        name = rec["name"]

    result = await client.query_cognitive(name, at_scene_episode=5, at_scene_number=1)
    assert isinstance(result["knows_facts"], list)
    assert isinstance(result["knows_characters"], list)
    # By episode 5, the protagonist should know SOMETHING.
    assert len(result["knows_facts"]) > 0 or len(result["knows_characters"]) > 0
```

- [ ] **Step 2: Run test (assumes Phase 6 has run)**

Run: `pytest tests/test_03_query.py -v`
Expected: pass (or skip if bazong_demo empty).

- [ ] **Step 3: Commit**

```bash
git add tests/test_03_query.py
git commit -m "test: rewrite test_03_query against bazong_demo with skip-if-empty guard"
```


### Task 7.4: Rewrite test_04_hl_ingest.py

**Files:**
- Modify: `tests/test_04_hl_ingest.py` (full rewrite)

- [ ] **Step 1: Replace**

```python
# tests/test_04_hl_ingest.py
"""HL-layer ingest test — verify Trope and viral BeatTypes extracted from a small synthetic script."""
from __future__ import annotations

import pytest

from screenplay_memory.client import MemoryClient


SYNTHETIC_HL_SCRIPT = """\
【第1集第1场】场景：厉氏集团办公室 / 时间：上午
[厉北辰一脸冷峻，让秘书查苏念的背景。]
厉北辰：「这种拜金女，我见多了。」（钩子：他说这话时镜头一直对着他手里苏念的简历）

【第2集第3场】场景：苏家祖宅 / 时间：夜晚
[苏念跪在祖父的灵前。]
苏念：「爷爷，他们都误会我了，但我答应过您要查清真相，不能放弃。」
[镜头闪回当年苏家大火的场景。]

【第5集第6场】场景：厉氏酒会 / 时间：夜晚
[渣前男友陈致远当众羞辱苏念，称她是骗子。]
苏念：「你说我是骗子？」（冷笑）「那你看看这个。」
[她拿出苏家家主令牌，全场震惊。陈致远脸色煞白。]
苏念：「我才是苏家二小姐。」
[厉北辰震惊到杯子滑落。]
"""


@pytest.fixture
async def client():
    mc = MemoryClient(project_id="test_04_hl")
    await mc.clear()
    yield mc
    await mc.clear()
    await mc.close()


async def test_hl_ingest_extracts_viral_beats_and_tropes(client):
    await client.ingest_hl(SYNTHETIC_HL_SCRIPT)
    async with client._graphiti.driver.session() as s:
        r = await s.run(
            "MATCH (n) WHERE n.group_id='test_04_hl__hl' AND 'Beat' IN labels(n) "
            "RETURN n.beat_type AS bt"
        )
        bt = {row["bt"] async for row in r}

        r2 = await s.run(
            "MATCH (n:Trope) WHERE n.group_id='test_04_hl__hl' RETURN n.trope_name AS t"
        )
        tropes = {row["t"] async for row in r2}

    # The synthetic script has clear FacePlay (酒会打脸) and Twist (身份揭穿)
    assert "FacePlay" in bt or "Twist" in bt, f"expected FacePlay/Twist, got {bt}"

    # Should pick up at least 1 trope
    assert len(tropes) >= 1, f"expected ≥1 Trope, got {tropes}"
```

- [ ] **Step 2: Run (~$0.30)**

Run: `pytest tests/test_04_hl_ingest.py -v`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/test_04_hl_ingest.py
git commit -m "test: rewrite test_04_hl_ingest for 10 BeatTypes + Trope extraction"
```


### Task 7.5: Rewrite test_06_api.py + verify test_05_*.py untouched

**Files:**
- Modify: `tests/test_06_api.py` (update mock data for new entity types)
- Verify: `tests/test_05_customization.py` and `tests/test_05_edits.py` (no change expected)

- [ ] **Step 1: Run existing test_05 suite to confirm no regression**

Run: `pytest tests/test_05_customization.py tests/test_05_edits.py -v`
Expected: pass (these don't depend on specific ontology).

- [ ] **Step 2: Read current test_06_api.py mock setup**

Run: `cat tests/test_06_api.py | head -80`
Note any hardcoded entity type names like "Character" / "Scene" — these likely still work, but check for any "PlotEvent" assumptions.

- [ ] **Step 3: Update mock graph fixtures in test_06 to include 1-2 of each new entity type**

(Exact edit depends on current fixture shape — typically the test creates a small in-memory graph. Add nodes with labels=["Identity"], labels=["Misunderstanding"], etc., and verify GraphDTO returns them with properties.)

- [ ] **Step 4: Run**

Run: `pytest tests/test_06_api.py -v`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/test_06_api.py
git commit -m "test: refresh test_06_api mock fixtures for new entity types"
```

---

## Phase 8 — API Bridge Layer (1 task)

### Task 8.1: Add ?layer=bridge support to /graph endpoint

**Files:**
- Modify: `api/routes/graph.py`
- Modify: `api/models.py` (extend Layer Literal)

- [ ] **Step 1: Update Layer type in models.py**

Find `Layer = Literal["detail", "hl"]` and change to `Layer = Literal["detail", "hl", "bridge"]`.

- [ ] **Step 2: Update graph.py to handle bridge layer**

Replace the `gid` calculation block:

```python
async def get_graph(
    project_id: str,
    layer: Layer = "detail",
    limit: int = 500,
    cache: ClientCache = Depends(get_cache),
) -> GraphDTO:
    client = await get_client(project_id, cache)

    if layer == "detail":
        gid = project_id
        node_q = "MATCH (n) WHERE n.group_id=$gid"
        edge_q = "MATCH (a)-[r]->(b) WHERE r.group_id=$gid"
        params: dict = {"gid": gid, "limit": limit}
    elif layer == "hl":
        gid = f"{project_id}__hl"
        node_q = "MATCH (n) WHERE n.group_id=$gid"
        edge_q = "MATCH (a)-[r]->(b) WHERE r.group_id=$gid"
        params = {"gid": gid, "limit": limit}
    else:  # bridge
        # Show: Beats from HL + their COVERS-target Scenes from detail +
        # all bridge-group_id edges between them.
        node_q = (
            "MATCH (n) WHERE n.group_id IN [$gid_d, $gid_hl, 'bridge'] "
            "AND (n:Beat OR n:Scene OR n.group_id='bridge')"
        )
        edge_q = "MATCH (a)-[r]->(b) WHERE r.group_id='bridge'"
        params = {
            "gid_d": project_id, "gid_hl": f"{project_id}__hl", "limit": limit,
        }

    async with client._graphiti.driver.session() as sess:
        # ... rest of node/edge fetch logic, parametrized by node_q / edge_q / params
```

(Adapt the existing function — same fetch shape, just with the precomputed `node_q` / `edge_q` / `params`.)

- [ ] **Step 3: Update frontend types.ts to match**

Edit `web/src/types.ts`:
```typescript
export type Layer = "detail" | "hl" | "bridge";
```

- [ ] **Step 4: Verify with curl**

Run:
```bash
curl -s "http://localhost:8000/projects/bazong_demo/graph?layer=bridge" | python -m json.tool | head -30
```
Expected: nodes array contains a mix of Beat + Scene labels.

- [ ] **Step 5: Commit**

```bash
git add api/routes/graph.py api/models.py web/src/types.ts
git commit -m "feat(api): add ?layer=bridge for cross-layer Beat-COVERS-Scene view"
```

---

## Phase 9 — Frontend: Tokens + Types + Mock (1 task)

### Task 9.1: Add color CSS vars + extend KIND_ZH

**Files:**
- Modify: `web/src/tokens.css`
- Modify: `web/src/mockdata.ts`
- Modify: `web/src/types.ts` (already updated in Task 8.1; double-check)

- [ ] **Step 1: Read tokens.css to find the variable block**

Run: `cat web/src/tokens.css`
Note current vars (`--char-500`, `--scene-500`, etc.) and dark-mode override block.

- [ ] **Step 2: Add 8 new vars + dark-mode variants**

Append to the `:root` block:
```css
  --ident-500:  #e88290;
  --family-500: #9b6f3a;
  --org-500:    #3a5f9b;
  --loc-500:    #3a8b4f;
  --item-500:   #d4a017;
  --mis-500:    #7e3a9b;
  --secret-500: #3a1e5e;
  --trope-500:  #e6c870;
```

Append to the `@media (prefers-color-scheme: dark)` block:
```css
  --ident-500:  #f0a3ad;
  --family-500: #b88f53;
  --org-500:    #5a82c5;
  --loc-500:    #5fad7a;
  --item-500:   #e8b945;
  --mis-500:    #a563c7;
  --secret-500: #5a3680;
  --trope-500:  #f5e094;
```

- [ ] **Step 3: Update mockdata.ts KIND_ZH map**

Find the `KIND_ZH` object and add:
```typescript
  Identity: "身份",
  Family: "家族",
  Organization: "组织",
  Location: "场所",
  Item: "道具",
  Misunderstanding: "误会",
  Secret: "秘密",
  Trope: "套路",
```

- [ ] **Step 4: pnpm typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/tokens.css web/src/mockdata.ts
git commit -m "feat(web): add 8 new entity colors + Chinese kind labels"
```

---

## Phase 10 — Frontend: ForceGraphPanel rewrite (3 tasks)

### Task 10.1: Extend KIND_COLOR_VARS + node sizing

**Files:**
- Modify: `web/src/components/ForceGraphPanel.tsx` (top of file)

- [ ] **Step 1: Replace KIND_COLOR_VARS**

```typescript
const KIND_COLOR_VARS: Record<string, string> = {
  Character: "--char-500",
  Identity: "--ident-500",
  Family: "--family-500",
  Organization: "--org-500",
  Location: "--loc-500",
  Item: "--item-500",
  Misunderstanding: "--mis-500",
  Secret: "--secret-500",
  Scene: "--scene-500",
  PlotEvent: "--event-500",
  Beat: "--beat-500",
  Arc: "--arc-500",
  Theme: "--theme-500",
  Trope: "--trope-500",
};
```

- [ ] **Step 2: Update nodeSize to handle new types**

Replace the `nodeSize` function:
```typescript
function nodeSize(node: NodeDTO): number {
  const tension = node.properties.tension_level as number | undefined;
  if (typeof tension === "number") return 8 + tension * 1.2;
  if (node.labels.includes("Character")) return 14;
  if (node.labels.includes("Arc")) return 16;
  if (node.labels.includes("Theme")) return 14;
  if (node.labels.includes("Family")) return 13;
  if (node.labels.includes("Trope")) return 13;
  if (node.labels.includes("Organization")) return 12;
  if (node.labels.includes("Misunderstanding")) return 11;
  if (node.labels.includes("Secret")) return 11;
  if (node.labels.includes("Identity")) return 10;
  if (node.labels.includes("Item")) return 10;
  if (node.labels.includes("Location")) return 10;
  if (node.labels.includes("Scene")) return 10;
  return 11;
}
```

- [ ] **Step 3: pnpm typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ForceGraphPanel.tsx
git commit -m "feat(web): wire new color vars + sizing for 14 entity types"
```


### Task 10.2: Add edge type-aware rendering + click hit-test

**Files:**
- Modify: `web/src/components/ForceGraphPanel.tsx`

- [ ] **Step 1: Extend Props interface to accept onSelectEdge**

```typescript
interface Props {
  graph: { nodes: NodeDTO[]; edges: EdgeDTO[] };
  selectedUuid: string | null;
  selectedEdgeUuid: string | null;
  onSelect: (uuid: string | null) => void;
  onSelectEdge: (uuid: string | null) => void;
  title: string;
  inkStyle?: boolean;
}
```

- [ ] **Step 2: Add edge type style helper**

```typescript
function edgeStyle(e: EdgeDTO, hi: boolean): {
  color: string; lineWidth: number; dash: number[];
} {
  const isResolved = (e.properties.is_resolved as boolean | undefined) ?? false;
  const strength = (e.properties.relation_strength as number | undefined) ?? 3;
  if (e.type === "BelievesAbout") {
    const alpha = isResolved ? 0.4 : 1.0;
    return {
      color: hi ? `rgba(126,58,155,${alpha})` : `rgba(126,58,155,${0.3 * alpha})`,
      lineWidth: 2,
      dash: [6, 3],
    };
  }
  if (e.type === "KnowsSecret") {
    return {
      color: hi ? "rgba(58,30,94,0.95)" : "rgba(58,30,94,0.4)",
      lineWidth: 2.5,
      dash: [],
    };
  }
  // Default ScreenplayRelation
  return {
    color: hi ? "rgba(228,0,43,0.7)" : "rgba(5,5,5,0.14)",
    lineWidth: hi ? Math.max(1.5, strength * 0.4) : 0.8,
    dash: [],
  };
}
```

- [ ] **Step 3: Use edgeStyle in render loop**

In the edges-render block, replace the hardcoded `ctx.strokeStyle`/`ctx.lineWidth` with:
```typescript
const style = edgeStyle(originalEdge, hi);
ctx.strokeStyle = style.color;
ctx.lineWidth = style.lineWidth;
ctx.setLineDash(style.dash);
// ... ctx.stroke() ...
ctx.setLineDash([]);
```

(You'll need to keep a reference to the original `EdgeDTO` per `SimEdge`. Add `props: Record<string, unknown>` and `kind: string` to the `SimEdge` interface and populate them in the seed effect.)

- [ ] **Step 4: Add edge hit-test for click**

In the `onDown` pointer handler, after the `locateNode` check (and before the deselect branch), add (note variable rename to avoid shadowing the pointer event):

```typescript
if (!n) {
  const hitEdge = locateEdge(ev.clientX, ev.clientY);
  if (hitEdge) {
    onSelectEdge(hitEdge.uuid);
    onSelect(null);
    return;
  }
  onSelect(null);
  onSelectEdge(null);
}
```

(Rename the pointer event parameter from `e` to `ev` in the `onDown` handler signature: `const onDown = (ev: React.PointerEvent<HTMLDivElement>) => {`. Same for `onMove`/`onUp` if they reference `e`.)

Add the `locateEdge` helper that does point-to-line-segment distance for each edge:
```typescript
const locateEdge = (clientX: number, clientY: number): SimEdge | null => {
  const sim = simRef.current;
  const canvas = canvasRef.current;
  if (!sim || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left - rect.width / 2;
  const my = clientY - rect.top - rect.height / 2;
  const idToNode = new Map(sim.nodes.map((n) => [n.id, n]));
  for (const ed of sim.edges) {
    const a = idToNode.get(ed.source);
    const b = idToNode.get(ed.target);
    if (!a || !b) continue;
    const d = pointToSegment(mx, my, a.x, a.y, b.x, b.y);
    if (d < 6) return ed;
  }
  return null;
};

function pointToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
```

- [ ] **Step 5: pnpm typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ForceGraphPanel.tsx
git commit -m "feat(web): edge-type-aware rendering + click hit-test"
```


### Task 10.3: Add hover emoji for KnowsSecret knowledge_source

**Files:**
- Modify: `web/src/components/ForceGraphPanel.tsx`

- [ ] **Step 1: Add hover-state tracking**

In the simulation state, add `hoverEdge: string | null`. Add a pointer-move handler that runs `locateEdge` on every move and updates `simRef.current.hoverEdge`.

- [ ] **Step 2: In the edge render loop, after drawing the line, emit emoji if this is the hovered edge AND it's KnowsSecret**

```typescript
if (sim.hoverEdge === e.uuid && e.kind === "KnowsSecret") {
  const src = (e.props.knowledge_source as string | undefined) ?? "unknown";
  const emoji =
    src === "witnessed" ? "👁️" :
    src === "told_by"   ? "🗣️" :
    src === "deduced"   ? "💭" :
    src === "born_with" ? "🩸" : "❓";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, cx + (a.x + b.x) / 2, cy + (a.y + b.y) / 2);
}
```

- [ ] **Step 3: pnpm typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual browser test**

Run dev server: `cd web && pnpm dev`
Open http://localhost:5173, navigate to Graph page (after Tab task; for now any KnowsSecret edge in detail view), hover over a KnowsSecret edge.
Expected: emoji appears in the middle of that edge.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ForceGraphPanel.tsx
git commit -m "feat(web): hover emoji for KnowsSecret knowledge_source"
```

---

## Phase 11 — Frontend: NodeInspector rewrite (1 task)

### Task 11.1: Replace NodeInspector with structured display

**Files:**
- Modify: `web/src/components/NodeInspector.tsx` (full rewrite)

- [ ] **Step 1: Read current to preserve API edit handlers (rename / delete / addEdge)**

Run: `head -90 web/src/components/NodeInspector.tsx`

- [ ] **Step 2: Rewrite — preserve handlers, replace display**

Key changes (apply on top of existing skeleton):

1. **Replace the raw-JSON `<pre>` block** with field-by-field rendering. Add a helper:
```typescript
function FieldsTable({ fields }: { fields: Array<[string, unknown]> }) {
  return (
    <table style={{ width: "100%", fontSize: 12 }}>
      <tbody>
        {fields.map(([k, v]) => (
          <tr key={k}>
            <td style={{ color: "#888", paddingRight: 8 }}>{k}</td>
            <td>{Array.isArray(v) ? v.join(", ") : String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

2. **Add 1-hop neighbor chips** computed from `graph.edges`:
```typescript
const neighbors = useMemo(() => {
  const ns: NodeDTO[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    let otherId: string | null = null;
    if (e.source === node.uuid) otherId = e.target;
    else if (e.target === node.uuid) otherId = e.source;
    if (otherId && !seen.has(otherId)) {
      seen.add(otherId);
      const other = graph.nodes.find((n) => n.uuid === otherId);
      if (other) ns.push(other);
    }
  }
  return ns;
}, [graph, node.uuid]);
```

Render them as colored chips (use `nodeColor`-style logic).

3. **Add scene_appearances list** from `node.properties.scene_appearances`:
```typescript
const sceneUUIDs = (node.properties.scene_appearances as string[] | undefined) ?? [];
const scenes = sceneUUIDs
  .map((uuid) => graph.nodes.find((n) => n.uuid === uuid))
  .filter(Boolean) as NodeDTO[];
```

Render as `S{ep}E{sc}` chips.

4. **Type-specific extras**: if Character, list IS_PERSONA_OF Identity neighbors as a separate section. If Misunderstanding, show severity as a stars rating. (Use simple conditional blocks.)

- [ ] **Step 3: pnpm typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual browser test**

Open Graph page, click on a Character node (e.g. 苏念). Verify:
- Header shows name + 类型 chip + status_tags chips
- 基础属性 table shows role_type / gender / status_tags
- 身份 (N) section lists Identity neighbors
- 1-hop 邻居 shows colored chips for all neighbors
- 出现于 (M 场) shows scene chips

- [ ] **Step 5: Commit**

```bash
git add web/src/components/NodeInspector.tsx
git commit -m "feat(web): restructure NodeInspector with typed fields, neighbors, scenes"
```

---

## Phase 12 — Frontend: EdgeInspector new (1 task)

### Task 12.1: Create EdgeInspector and wire selection

**Files:**
- Create: `web/src/components/EdgeInspector.tsx`
- Modify: `web/src/pages/Graph.tsx` (wire selection state)

- [ ] **Step 1: Create EdgeInspector.tsx**

```typescript
// web/src/components/EdgeInspector.tsx
import { useState } from "react";
import { api } from "../api";
import type { EdgeDTO, GraphDTO, NodeDTO } from "../types";

interface Props {
  projectId: string;
  demo: boolean;
  edge: EdgeDTO;
  graph: GraphDTO;
  onRefresh: () => void;
  onClose: () => void;
}

export default function EdgeInspector({
  projectId, demo, edge, graph, onRefresh, onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const src = graph.nodes.find((n) => n.uuid === edge.source);
  const dst = graph.nodes.find((n) => n.uuid === edge.target);

  const sceneUuids = (edge.properties.scene_appearances as string[] | undefined) ?? [];
  const quotesRaw = edge.properties.quotes as string | undefined;
  const quotes: Array<{ scene_uuid: string; snippet: string }> = quotesRaw
    ? JSON.parse(quotesRaw)
    : [];

  const sceneNameOf = (uuid: string): string => {
    const n = graph.nodes.find((x) => x.uuid === uuid);
    if (!n) return uuid.slice(0, 8);
    const ep = n.properties.episode as number | undefined;
    const sc = n.properties.scene_number as number | undefined;
    return typeof ep === "number" && typeof sc === "number"
      ? `S${String(ep).padStart(2, "0")}E${String(sc).padStart(2, "0")}`
      : (n.name ?? uuid.slice(0, 8));
  };

  async function remove() {
    if (demo || !edge.uuid) return;
    if (!confirm(`删除边 "${edge.type}"？`)) return;
    setBusy(true); setError(null);
    try {
      await api.del(`/projects/${projectId}/edges/${edge.uuid}`);
      onClose(); onRefresh();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <aside style={{ width: 320, padding: "18px 20px", background: "#fff",
                    borderLeft: "1px solid var(--divider-strong)",
                    overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row">
        <span className="kicker">边详情</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} className="btn sm ghost">关闭</button>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span className="chip">{src?.name ?? "?"}</span>
          <span style={{ color: "#888" }}>━━▶</span>
          <span className="chip">{dst?.name ?? "?"}</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
          {edge.type}
        </div>
      </div>

      <div>
        <div className="tiny muted" style={{ marginBottom: 4 }}>边属性</div>
        <table style={{ width: "100%", fontSize: 12 }}>
          <tbody>
            {Object.entries(edge.properties)
              .filter(([k]) => !["scene_appearances", "quotes", "episodes"].includes(k))
              .filter(([k]) => !k.endsWith("_embedding"))
              .map(([k, v]) => (
                <tr key={k}>
                  <td style={{ color: "#888", paddingRight: 8 }}>{k}</td>
                  <td>{Array.isArray(v) ? v.join(", ") : String(v)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {sceneUuids.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 4 }}>
            出现于 ({sceneUuids.length} 场)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {sceneUuids.map((uuid) => (
              <span key={uuid} className="chip" style={{ fontSize: 10 }}>
                {sceneNameOf(uuid)}
              </span>
            ))}
          </div>
        </div>
      )}

      {quotes.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 4 }}>原文片段</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {quotes.map((q, i) => (
              <div key={i} style={{ padding: 6, background: "var(--ink-050)", fontSize: 11 }}>
                <span className="mono tiny" style={{ color: "#888", marginRight: 6 }}>
                  {sceneNameOf(q.scene_uuid)}
                </span>
                {q.snippet}
              </div>
            ))}
          </div>
        </div>
      )}

      {!demo && (
        <button className="btn sm block danger" onClick={remove} disabled={busy}
                style={{ marginTop: 4 }}>
          删除此边
        </button>
      )}
      {error && <div className="tiny" style={{ color: "var(--err)" }}>{error}</div>}
    </aside>
  );
}
```

- [ ] **Step 2: Wire selection in Graph.tsx**

Add `selectedEdgeUuid` state alongside `selectedUuid`. When `onSelectEdge` fires, set edge state and clear node state (and vice versa for `onSelect`). Render `<EdgeInspector ... />` when edge is selected, `<NodeInspector ... />` when node is selected.

```typescript
const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
const [selectedEdgeUuid, setSelectedEdgeUuid] = useState<string | null>(null);

const selectedNode = graph?.nodes.find((n) => n.uuid === selectedUuid) ?? null;
const selectedEdge = graph?.edges.find((e) => e.uuid === selectedEdgeUuid) ?? null;

// in JSX:
{selectedNode && (
  <NodeInspector node={selectedNode} graph={graph!}
                 projectId={projectId} demo={demo}
                 onClose={() => setSelectedUuid(null)} onRefresh={refetch} />
)}
{selectedEdge && (
  <EdgeInspector edge={selectedEdge} graph={graph!}
                 projectId={projectId} demo={demo}
                 onClose={() => setSelectedEdgeUuid(null)} onRefresh={refetch} />
)}
```

Pass `onSelectEdge={setSelectedEdgeUuid}` (and clear opposite) to ForceGraphPanel.

- [ ] **Step 3: pnpm typecheck + browser smoke test**

Run: `cd web && pnpm tsc --noEmit && pnpm dev`
Expected: clean. Browser: click on an edge → EdgeInspector opens; click on a node → NodeInspector opens; never both.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/EdgeInspector.tsx web/src/pages/Graph.tsx
git commit -m "feat(web): add EdgeInspector with edge metadata + scenes + quotes"
```

---

## Phase 13 — Frontend: 3-Tab Layer Switching (1 task)

### Task 13.1: Restructure Graph.tsx with detail/HL/bridge tabs

**Files:**
- Modify: `web/src/pages/Graph.tsx`

- [ ] **Step 1: Add layer state + fetch on layer change**

```typescript
const [layer, setLayer] = useState<Layer>("detail");
const { graph, refetch } = useGraph(projectId, layer);  // existing hook, add layer param

useEffect(() => {
  setSelectedUuid(null);
  setSelectedEdgeUuid(null);
}, [layer]);
```

- [ ] **Step 2: Update useGraph hook (or whatever fetches the graph) to take a layer param**

If `useGraph` exists in `web/src/api.ts` or similar:
```typescript
export async function fetchGraph(projectId: string, layer: Layer = "detail"): Promise<GraphDTO> {
  return api.get(`/projects/${projectId}/graph?layer=${layer}`);
}
```

- [ ] **Step 3: Render Tab bar at top of Graph.tsx**

```typescript
<div style={{ display: "flex", borderBottom: "1px solid var(--hairline)", marginBottom: 12 }}>
  {(["detail", "hl", "bridge"] as Layer[]).map((L) => (
    <button
      key={L}
      onClick={() => setLayer(L)}
      style={{
        padding: "10px 18px",
        background: layer === L ? "var(--ink-000)" : "transparent",
        color: layer === L ? "var(--char-500)" : "var(--ink-600)",
        fontWeight: layer === L ? 700 : 500,
        cursor: "pointer",
        border: "none",
        borderBottom: layer === L ? "2px solid var(--char-500)" : "2px solid transparent",
      }}
    >
      {L === "detail" ? "详细图谱" : L === "hl" ? "节拍图谱" : "桥接视图"}
      <span className="tiny muted" style={{ marginLeft: 6 }}>
        · {graph?.nodes.length ?? 0} 节点 · {graph?.edges.length ?? 0} 边
      </span>
    </button>
  ))}
</div>
```

- [ ] **Step 4: pnpm typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual test all 3 tabs**

Open Graph page. Click each tab. Verify:
- Detail: shows the 100+ node bazong_demo graph, all 10 entity types visible.
- HL: shows ~10-20 nodes (Beats, Tropes, Themes, Arcs).
- Bridge: shows Beats + Scenes connected by COVERS edges.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Graph.tsx web/src/api.ts
git commit -m "feat(web): 3-tab layer switching (detail / HL / bridge)"
```

---

## Phase 14 — Demo Script + Final QA (2 tasks)

### Task 14.1: Rewrite scripts/demo.py for new ontology

**Files:**
- Modify: `scripts/demo.py` (full rewrite)

- [ ] **Step 1: Replace with new 3-act demo**

```python
#!/usr/bin/env python3
# scripts/demo.py
"""bazong_demo CLI driver.

Three demo acts:

    # Act 1 — 认知边界对比 (LLM with vs without memory)
    python scripts/demo.py ask --memory --character 厉北辰 --at 3,2 \\
        --q "在第3集第2场之前，厉北辰知道苏念真实身份吗？"
    python scripts/demo.py ask --no-memory ...

    # Act 2 — 多角色视角对比
    python scripts/demo.py who-all --at 5,3

    # Act 3 — 节拍 + 套路统计
    python scripts/demo.py beats
    python scripts/demo.py tropes
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from screenplay_memory.client import MemoryClient

PROJECT = "bazong_demo"


async def cmd_beats(args):
    mc = MemoryClient(project_id=PROJECT)
    try:
        async with mc._graphiti.driver.session() as s:
            r = await s.run(
                "MATCH (b:Beat) WHERE b.group_id=$gid "
                "RETURN b.beat_type AS bt, b.tension_level AS tl, b.beat_summary AS sm "
                "ORDER BY b.tension_level DESC",
                gid=f"{PROJECT}__hl",
            )
            print(f"{'BeatType':<18} {'张力':>4}  概述")
            print("─" * 70)
            async for row in r:
                print(f"{row['bt']:<18} {row['tl']:>4}  {row['sm'][:50]}")
    finally:
        await mc.close()


async def cmd_tropes(args):
    mc = MemoryClient(project_id=PROJECT)
    try:
        async with mc._graphiti.driver.session() as s:
            r = await s.run(
                "MATCH (t:Trope) WHERE t.group_id=$gid "
                "RETURN t.trope_name AS n, t.trope_category AS c, t.popularity_score AS p "
                "ORDER BY t.popularity_score DESC",
                gid=f"{PROJECT}__hl",
            )
            print(f"{'套路':<20} {'类型':<14} {'流行度':>6}")
            print("─" * 50)
            async for row in r:
                print(f"{row['n']:<20} {row['c']:<14} {row['p']:>6}")
    finally:
        await mc.close()


# (ask / who-all commands: keep same shape as old demo.py but use new project_id;
#  paste from old scripts/demo.py and change project_id to PROJECT)


def build_parser():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("beats")
    sub.add_parser("tropes")
    # add ask, who-all parsers as before
    return p


HANDLERS = {"beats": cmd_beats, "tropes": cmd_tropes}


def main():
    args = build_parser().parse_args()
    asyncio.run(HANDLERS[args.command](args))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run beats + tropes commands as smoke test**

Run: `python scripts/demo.py beats`
Expected: prints a table with 5-10 Beat rows.

Run: `python scripts/demo.py tropes`
Expected: prints a table with 5-10 Trope rows including 霸总人设 / 误会流 / 双向隐瞒.

- [ ] **Step 3: Commit**

```bash
git add scripts/demo.py
git commit -m "feat(demo): rewrite scripts/demo.py with beats + tropes commands"
```


### Task 14.2: End-to-end QA + final cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pytest -v`
Expected: all tests pass (test_07_scene_index might need docker up).

- [ ] **Step 2: Run lint**

Run: `ruff check src tests scripts`
Expected: no errors.

- [ ] **Step 3: Frontend typecheck + build**

Run: `cd web && pnpm tsc --noEmit && pnpm build`
Expected: no errors, build succeeds.

- [ ] **Step 4: Browser walkthrough checklist**

Start dev: `docker compose up -d && uvicorn api.main:app --port 8000` and `cd web && pnpm dev`. Open browser. For each item below, screenshot + verify:

- [ ] Projects page shows `bazong_demo`
- [ ] Click into bazong_demo → Graph page loads
- [ ] Tab "详细图谱": ≥10 distinct entity colors visible; force layout settles cleanly
- [ ] Click Character node 苏念: NodeInspector shows身份 (2)、家族、1-hop 邻居 chips、出现于 N 场
- [ ] Click another node from neighbor chips: navigation works
- [ ] Click a BelievesAbout edge: EdgeInspector shows since_episode/until_episode/confidence + 误会节点详情 + 出现于 + 原文片段
- [ ] Hover a KnowsSecret edge: emoji shows in middle (👁️/🗣️/💭)
- [ ] Tab "节拍图谱": 10+ Beat/Trope/Theme/Arc nodes; CliffHanger / FacePlay / Twist beats present
- [ ] Tab "桥接视图": Beats + Scenes connected by COVERS edges
- [ ] Dark mode toggle (OS-level): all 14 colors remain distinguishable

- [ ] **Step 5: Final cleanup commit (if any small fixes during QA)**

```bash
git status
git add ...
git commit -m "fix: small polish from end-to-end QA"
```

- [ ] **Step 6: Push branch**

```bash
git push -u origin feat/viral-demo
```

---

## Done

Branch `feat/viral-demo` ready to merge to main. Total commits: ~25. Total LLM cost: ~$3 (well under $5 budget). Total dev time: ~3.5 days.
