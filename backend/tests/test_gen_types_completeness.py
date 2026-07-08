"""Completeness test for scripts/gen_types.py MODELS registry (ARC-019).

``scripts/gen_types.py`` hand-curates the list of Pydantic models it exports to
``frontend/src/types/generated.ts``. If a model is added under
``backend/app/models/`` but forgotten in that list, it is silently omitted
from the frontend types — and the type-drift CI cannot catch the omission,
because that CI only checks that ``generated.ts`` matches what ``gen_types.py``
would produce from the *current* MODELS list, not that MODELS itself is
complete.

This test fails if a ``BaseModel`` subclass exists under ``app.models.*`` but is
neither in ``gen_types.MODELS`` nor in the ``EXCLUDED`` dict below. Every
exclusion must carry a one-line reason; a reasonless or stale entry is itself a
failure.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import pkgutil
from pathlib import Path

from pydantic import BaseModel

import app.models

# Shared reason for the 7 ARC-014 family event models — they each bind a
# multi-value ``Literal[EventType, ...]`` tag that collides with the frontend
# ``EventType`` StrEnum union and would shrink it to only that family's tags.
# The wire format is the flat legacy ``Event`` / ``EventData`` shape (both in
# MODELS); family payloads are emitted via their ``*EventData`` classes.
_FAMILY_EVENT_REASON = (
    "family event model; Literal[EventType] collides with frontend EventType union (ARC-014)"
)

# Each excluded model name maps to the reason it is NOT emitted to
# generated.ts. Adding a name here without a concrete, non-empty reason is a
# test failure. Keep this list small and review it whenever a model is added.
EXCLUDED: dict[str, str] = {
    # Internal envelope base for the 7 family event models. Defines only
    # session_id / timestamp and a validator; never instantiated or produced
    # on the wire by itself.
    "_EventBase": (
        "internal base class for the family event models; never produced on the wire by itself"
    ),
    # ARC-014 family event models (see _FAMILY_EVENT_REASON above).
    "SessionEvent": _FAMILY_EVENT_REASON,
    "ToolEvent": _FAMILY_EVENT_REASON,
    "PromptEvent": _FAMILY_EVENT_REASON,
    "AgentEvent": _FAMILY_EVENT_REASON,
    "LifecycleEvent": _FAMILY_EVENT_REASON,
    "TaskEvent": _FAMILY_EVENT_REASON,
    "BackgroundTaskEvent": _FAMILY_EVENT_REASON,
    # Already emitted transitively: KanbanTask is a ``list[KanbanTask]`` field
    # of ``WhiteboardData`` (which IS in MODELS), so ``models_json_schema``
    # includes it as a ``$defs`` reference and ``json2ts`` emits it as an
    # ``export interface KanbanTask`` in generated.ts. Adding it to MODELS
    # would make it a top-level export and change generated.ts.
    "KanbanTask": (
        "transitive $defs reference of WhiteboardData; adding to MODELS changes generated.ts"
    ),
}

# scripts/gen_types.py lives at the repo root, two parents above this test.
GEN_TYPES_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gen_types.py"


def _discover_model_classes() -> dict[str, type[BaseModel]]:
    """Return ``{class_name: class}`` for every BaseModel subclass defined under app.models.*.

    Only classes defined in the module being inspected are included (not
    re-exports): ``obj.__module__ == module.__name__`` filters out classes that
    a module merely re-imports. The package is currently flat (no subpackages);
    if a subpackage is ever added under ``app.models``, switch to
    ``pkgutil.walk_packages``.
    """
    found: dict[str, type[BaseModel]] = {}
    for mod_info in pkgutil.iter_modules(app.models.__path__):
        module = importlib.import_module(f"app.models.{mod_info.name}")
        for _name, obj in inspect.getmembers(module, inspect.isclass):
            if (
                issubclass(obj, BaseModel)
                and obj is not BaseModel
                and obj.__module__ == module.__name__
            ):
                found[obj.__name__] = obj
    return found


def _load_gen_types_model_names() -> set[str]:
    """Parse scripts/gen_types.py and return the class names listed in its MODELS list.

    Uses AST parsing rather than importing gen_types, because importing that
    module triggers the full type-generation pipeline (writes the JSON schema,
    spawns ``bunx json2ts``, rewrites ``generated.ts``) as a module-level side
    effect — which we must not trigger from a test.
    """
    source = GEN_TYPES_PATH.read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "MODELS"
            and isinstance(node.value, ast.List)
        ):
            names: set[str] = set()
            for elt in node.value.elts:
                if not isinstance(elt, ast.Name):
                    raise AssertionError(
                        "MODELS list in scripts/gen_types.py contains a non-name element: "
                        f"{ast.dump(elt)}"
                    )
                names.add(elt.id)
            return names
    raise AssertionError("MODELS list not found in scripts/gen_types.py")


def test_every_model_is_exported_or_excluded() -> None:
    """Every BaseModel subclass under app.models.* is in gen_types.MODELS or EXCLUDED.

    This is the core ARC-019 omission guard. If it fails, a model was added
    under backend/app/models/ without being added to the MODELS list in
    scripts/gen_types.py (preferred, if it is part of the wire contract) or to
    the EXCLUDED dict above (with a reason, if it is intentionally internal).
    """
    discovered = _discover_model_classes()
    exported = _load_gen_types_model_names()

    missing = sorted(name for name in discovered if name not in exported and name not in EXCLUDED)
    assert not missing, (
        "BaseModel subclass(es) under app.models.* are missing from both "
        "scripts/gen_types.py MODELS and the EXCLUDED dict in this test. "
        "Either add the model to MODELS in scripts/gen_types.py (preferred, "
        "if it is part of the wire contract) or add it to EXCLUDED with a "
        "one-line reason. Missing:\n  " + "\n  ".join(missing)
    )


def test_excluded_models_still_exist() -> None:
    """Every name in EXCLUDED is a real BaseModel subclass under app.models.*.

    Catches stale exclusion entries left behind after a model is renamed or
    deleted — a stale entry would silently mask a future re-addition under the
    same name.
    """
    discovered = _discover_model_classes()
    stale = sorted(name for name in EXCLUDED if name not in discovered)
    assert not stale, (
        "EXCLUDED in this test contains names that are not BaseModel subclasses "
        "under app.models.* — stale entries to remove:\n  " + "\n  ".join(stale)
    )


def test_excluded_entries_have_reasons() -> None:
    """Every EXCLUDED entry carries a non-empty reason string (no silent catch-all)."""
    reasonless = sorted(
        name for name, reason in EXCLUDED.items() if not reason or not reason.strip()
    )
    assert not reasonless, (
        "EXCLUDED entries must carry a non-empty reason string:\n  " + "\n  ".join(reasonless)
    )


def test_no_model_is_both_exported_and_excluded() -> None:
    """No name appears in both gen_types.MODELS and EXCLUDED (contradictory)."""
    exported = _load_gen_types_model_names()
    overlap = sorted(exported & set(EXCLUDED))
    assert not overlap, (
        "A model is listed in BOTH scripts/gen_types.py MODELS and the EXCLUDED "
        "dict in this test — pick one:\n  " + "\n  ".join(overlap)
    )
