"""Simulation scenarios for the Claude Office Visualizer.

Each module exposes a single ``run(ctx)`` function that accepts a
:class:`~scripts.scenarios._base.SimulationContext` and drives the backend
event stream for one scenario. ``SCENARIOS`` is the canonical registry;
the CLI (``scripts/simulate_events.py``) imports it directly rather than
re-declaring the mapping.

Available scenarios
-------------------
- ``basic``      — Simple session: boss reads a file, spawns one agent, session ends.
- ``complex``    — Multi-agent workflow with context compaction and background tasks.
- ``edge_cases`` — Error paths, permission requests, and unusual event sequences.
- ``quick``      — Fast (~30 s) full-lifecycle smoke scenario.
- ``teams``      — Multi-session team scenario exercising the room-orchestrator merge.
"""

from collections.abc import Callable

from ._base import SimulationContext
from .basic import run as run_basic
from .complex import run as run_complex
from .edge_cases import run as run_edge_cases
from .quick import run as run_quick
from .teams import run as run_teams

SCENARIOS: dict[str, Callable[[SimulationContext], None]] = {
    "basic": run_basic,
    "complex": run_complex,
    "edge_cases": run_edge_cases,
    "quick": run_quick,
    "teams": run_teams,
}

__all__ = [
    "SCENARIOS",
    "SimulationContext",
    "run_basic",
    "run_complex",
    "run_edge_cases",
    "run_quick",
    "run_teams",
]
