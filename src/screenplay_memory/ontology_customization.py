"""Runtime ontology customization — user-editable entity/edge schemas.

The web demo lets a user tweak the extraction schema before running a
Graphiti ingest (e.g. add a new Character field, rename an edge type).
The spec is persisted in Neo4j as a single ``(:OntologyConfig)`` node per
``(project_id, layer)`` pair, so it survives container restarts and lives
next to the graph it describes.

Dynamic Pydantic class synthesis is the security-sensitive bit: we refuse
any type token outside a small whitelist. Otherwise an attacker with API
access could smuggle arbitrary type objects through ``pydantic.create_model``.

Spec shape::

    {
      "entities": [
        {
          "name": "Character",
          "description": "classdoc — becomes the LLM prompt",
          "fields": [
            {"name": "role_type", "type": "str",
             "optional": true, "default": "supporting",
             "description": "…"}
          ]
        }
      ],
      "edges": [ {"name": "ScreenplayRelation", "description": "...",
                  "fields": [...]} ]
    }
"""

from __future__ import annotations

import json
from typing import Any, Literal, get_args

from pydantic import BaseModel, Field, create_model
from pydantic_core import PydanticUndefined

# --- Type whitelist --------------------------------------------------------
# Any type token outside this map is rejected. Keep the set small; expand
# only after thinking about how an adversarial spec could abuse the new
# addition.
_PRIMITIVE_TYPES: dict[str, type] = {
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "list[str]": list[str],
    "list[int]": list[int],
}

_VALID_LAYERS = frozenset({"detail", "hl"})

# Name guards for dynamically-synthesised Pydantic classes.
# `str.isidentifier()` alone accepts dunder names (``__class__``, ``__init__``)
# and Pydantic v2 internals (``model_config``, ``model_fields`` …) which would
# either collide with BaseModel machinery or shadow private state. The class
# name + field name guards below reject those.
_MAX_NAME_LEN = 64
_PYDANTIC_RESERVED_FIELDS = frozenset({
    "model_config",
    "model_fields",
    "model_dump",
    "model_dump_json",
    "model_validate",
    "model_validate_json",
    "model_validate_strings",
    "model_json_schema",
    "model_copy",
    "model_construct",
    "model_fields_set",
    "model_extra",
    "model_parametrized_name",
    "model_post_init",
    "model_rebuild",
})


def _assert_safe_name(kind: str, name: object, *, is_field: bool) -> str:
    """Validate a class or field name. Raises on dunders, leading underscores,
    Pydantic-reserved names, excessive length, or non-identifiers."""
    if not isinstance(name, str) or not name.isidentifier():
        raise OntologySpecError(f"{kind}: not an identifier: {name!r}")
    if len(name) > _MAX_NAME_LEN:
        raise OntologySpecError(
            f"{kind}: {name!r} exceeds {_MAX_NAME_LEN} characters"
        )
    if name.startswith("_"):
        raise OntologySpecError(
            f"{kind}: {name!r} starts with '_', which is reserved for internals"
        )
    if is_field and name in _PYDANTIC_RESERVED_FIELDS:
        raise OntologySpecError(
            f"{kind}: {name!r} collides with a Pydantic BaseModel attribute"
        )
    return name


class OntologySpecError(ValueError):
    """Raised when a spec is missing required fields or uses a disallowed type."""


# --- Persistence -----------------------------------------------------------


async def load_spec(graphiti: Any, project_id: str, layer: str) -> dict | None:
    """Return the saved spec for ``(project_id, layer)``, or ``None`` if unset."""
    _check_layer(layer)
    async with graphiti.driver.session() as sess:
        result = await sess.run(
            """
            MATCH (c:OntologyConfig {project_id: $pid, layer: $layer})
            RETURN c.spec AS spec
            """,
            pid=project_id,
            layer=layer,
        )
        row = await result.single()
    if row is None or row["spec"] is None:
        return None
    return json.loads(row["spec"])


async def save_spec(
    graphiti: Any, project_id: str, layer: str, spec: dict
) -> None:
    """Upsert the spec for ``(project_id, layer)``.

    Validates the spec before writing so a bad spec can't silently land in
    the database and break the next ingest.
    """
    _check_layer(layer)
    # Round-trip through spec_to_pydantic to surface schema errors before
    # we touch the database.
    spec_to_pydantic(spec)
    async with graphiti.driver.session() as sess:
        await sess.run(
            """
            MERGE (c:OntologyConfig {project_id: $pid, layer: $layer})
            SET c.spec = $spec, c.updated_at = datetime()
            """,
            pid=project_id,
            layer=layer,
            spec=json.dumps(spec, ensure_ascii=False),
        )


# --- Validation + Pydantic synthesis ---------------------------------------


def spec_to_pydantic(spec: dict) -> tuple[dict[str, type[BaseModel]], dict[str, type[BaseModel]]]:
    """Build ``(entity_types, edge_types)`` dicts from a validated spec.

    Raises ``OntologySpecError`` for any shape or type mistake. The returned
    dicts are shaped like ``ENTITY_TYPES`` in ``screenplay_memory.ontology``,
    so they can be passed directly to ``graphiti.add_episode``.
    """
    if not isinstance(spec, dict):
        raise OntologySpecError("spec must be an object")
    entities_spec = spec.get("entities", [])
    edges_spec = spec.get("edges", [])
    if not isinstance(entities_spec, list) or not isinstance(edges_spec, list):
        raise OntologySpecError("'entities' and 'edges' must be arrays")

    entity_types = {cls.__name__: cls for cls in map(_build_model, entities_spec)}
    edge_types = {cls.__name__: cls for cls in map(_build_model, edges_spec)}
    return entity_types, edge_types


def _build_model(entry: dict) -> type[BaseModel]:
    if not isinstance(entry, dict):
        raise OntologySpecError(f"expected object, got {type(entry).__name__}")
    name = _assert_safe_name("class name", entry.get("name"), is_field=False)
    description = entry.get("description", "")
    fields_spec = entry.get("fields", [])
    if not isinstance(fields_spec, list):
        raise OntologySpecError(f"{name}.fields must be an array")

    fields: dict[str, tuple[Any, Any]] = {}
    for f in fields_spec:
        fname, ftype, finfo = _resolve_field(name, f)
        fields[fname] = (ftype, finfo)

    model = create_model(name, __doc__=description or None, **fields)
    return model


def _resolve_field(cls_name: str, field: dict) -> tuple[str, Any, Any]:
    if not isinstance(field, dict):
        raise OntologySpecError(f"{cls_name}: field entry must be an object")
    fname = _assert_safe_name(
        f"{cls_name} field name", field.get("name"), is_field=True
    )
    type_token = field.get("type")
    ftype = _resolve_type(cls_name, fname, type_token)

    description = field.get("description", "")
    default = field.get("default")
    optional = bool(field.get("optional", False))

    if default is None and not optional:
        # Required field → use Ellipsis as the default to mark it required.
        finfo = Field(..., description=description)
    elif ftype is list[str] or ftype is list[int]:
        # Mutable defaults need default_factory — build a small closure so
        # two instances don't share a list.
        factory = _list_factory(default or [])
        finfo = Field(default_factory=factory, description=description)
    else:
        finfo = Field(default=default, description=description)

    return fname, ftype, finfo


def _resolve_type(cls_name: str, fname: str, token: Any) -> Any:
    if isinstance(token, str):
        if token in _PRIMITIVE_TYPES:
            return _PRIMITIVE_TYPES[token]
        raise OntologySpecError(
            f"{cls_name}.{fname}: unsupported type {token!r}; "
            f"allowed: {sorted(_PRIMITIVE_TYPES)} or {{kind: 'literal', values: [...]}}"
        )
    if isinstance(token, dict) and token.get("kind") == "literal":
        values = token.get("values")
        if not isinstance(values, list) or not values:
            raise OntologySpecError(
                f"{cls_name}.{fname}: literal type needs a non-empty 'values' array"
            )
        # Literal only accepts hashable scalar values — str/int/bool pass;
        # anything else (dicts, lists) raises TypeError here, which we
        # re-wrap for a cleaner error message.
        for v in values:
            if not isinstance(v, (str, int, bool)):
                raise OntologySpecError(
                    f"{cls_name}.{fname}: literal values must be str/int/bool, got {v!r}"
                )
        return Literal[tuple(values)]  # type: ignore[valid-type]
    raise OntologySpecError(
        f"{cls_name}.{fname}: type must be a string token or literal object"
    )


def _list_factory(default_list: list):
    # Defensive copy so the caller's list and our default don't alias.
    snapshot = list(default_list)
    return lambda: list(snapshot)


def _check_layer(layer: str) -> None:
    if layer not in _VALID_LAYERS:
        raise OntologySpecError(
            f"layer must be one of {sorted(_VALID_LAYERS)}, got {layer!r}"
        )


# --- Dumping defaults for the UI "pre-fill" ---------------------------------


def default_spec_detail() -> dict:
    """Serialise the built-in detail ontology so the UI can pre-fill the form."""
    from screenplay_memory.ontology import ENTITY_TYPES, EDGE_TYPES

    return {
        "entities": [_dump_model(cls) for cls in ENTITY_TYPES.values()],
        "edges": [_dump_model(cls) for cls in EDGE_TYPES.values()],
    }


def _dump_model(cls: type[BaseModel]) -> dict:
    """Approximate a Pydantic class back into spec form for UI pre-fill.

    Round-trips the whitelisted types only; exotic annotations (e.g. nested
    BaseModel) are emitted as ``str`` so the UI still renders something.
    """
    entries = []
    for fname, field in cls.model_fields.items():
        ann = field.annotation
        token = _dump_type(ann)
        default = field.default
        if _is_unset(default):
            default = None
            optional = False
        else:
            optional = True
        entries.append(
            {
                "name": fname,
                "type": token,
                "description": field.description or "",
                "optional": optional,
                "default": default if _is_jsonable(default) else None,
            }
        )
    return {
        "name": cls.__name__,
        "description": (cls.__doc__ or "").strip(),
        "fields": entries,
    }


def _dump_type(ann: Any) -> Any:
    for token, t in _PRIMITIVE_TYPES.items():
        if ann is t:
            return token
    # Literal[...] → dict form
    try:
        args = get_args(ann)
        if args and all(isinstance(v, (str, int, bool)) for v in args):
            origin = getattr(ann, "__origin__", None)
            if origin is Literal or str(ann).startswith("typing.Literal"):
                return {"kind": "literal", "values": list(args)}
    except (TypeError, AttributeError):
        # Annotation isn't a typing form we can introspect — fall through
        # to the generic "str" fallback below so the UI still renders.
        pass
    return "str"  # graceful fallback so the UI still renders


def _is_unset(value: Any) -> bool:
    return value is PydanticUndefined


def _is_jsonable(value: Any) -> bool:
    try:
        json.dumps(value)
        return True
    except TypeError:
        return False
