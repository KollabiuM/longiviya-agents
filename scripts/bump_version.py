#!/usr/bin/env python3
"""Bump or check the project version across all synchronized locations.

Usage:
    bump_version.py [--dry-run] <x.y.z>   # rewrite or preview changes
    bump_version.py --check [<x.y.z>]     # verify (CI-friendly)

The six hand-maintained version locations are rewritten atomically:

    pyproject.toml                       (root)
    backend/pyproject.toml
    hooks/pyproject.toml
    frontend/package.json
    opencode-plugin/package.json
    frontend/src/app/page.tsx            (header badge)

Excluded because they are derived at runtime via importlib.metadata
(see ARC-021 / DOC-007) and must not be hand-edited:

    backend/app/config.py                (Settings.VERSION)
    hooks/src/claude_office_hooks/main.py (__version__)

Security scope: touches only the six allowlisted files above. Performs no
git or network operations and reads no env/secret files.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from functools import partial
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
_VERSION = r"\d+\.\d+\.\d+"


@dataclass(frozen=True)
class Location:
    """One version-bearing file: its repo-relative path and the single pattern
    that must match exactly once, capturing the version in group 1."""

    rel: str
    pattern: re.Pattern[str]


LOCATIONS: tuple[Location, ...] = (
    Location("pyproject.toml", re.compile(rf'(?m)^version = "({_VERSION})"$')),
    Location("backend/pyproject.toml", re.compile(rf'(?m)^version = "({_VERSION})"$')),
    Location("hooks/pyproject.toml", re.compile(rf'(?m)^version = "({_VERSION})"$')),
    Location("frontend/package.json", re.compile(rf'(?m)^  "version": "({_VERSION})",$')),
    Location("opencode-plugin/package.json", re.compile(rf'(?m)^  "version": "({_VERSION})",$')),
    Location("frontend/src/app/page.tsx", re.compile(rf"(?m)^[^\S\n]+v({_VERSION})[^\S\n]*$")),
)


def _read_current(loc: Location) -> str:
    """Return the single captured version for *loc*, or sys.exit on failure."""
    text = (REPO / loc.rel).read_text(encoding="utf-8")
    matches = loc.pattern.findall(text)
    if not matches:
        sys.exit(f"ERROR: version pattern not found in {loc.rel}")
    if len(matches) > 1:
        sys.exit(f"ERROR: version pattern matched {len(matches)} times in {loc.rel}")
    return matches[0]


def _repl(target: str, match: re.Match[str]) -> str:
    """Reconstruct the matched span with the captured version swapped for *target*."""
    return match.group(0).replace(match.group(1), target)


def cmd_check(target: str | None) -> int:
    """Verify locations agree. If *target* is given, all must equal it; otherwise
    they must all agree with each other (CI drift check)."""
    currents = {loc.rel: _read_current(loc) for loc in LOCATIONS}
    if target is None:
        values = set(currents.values())
        if len(values) > 1:
            print("ERROR: version locations disagree:")
            for rel, current in currents.items():
                print(f"  {rel}: {current}")
            return 1
        print(f"OK: all {len(LOCATIONS)} locations at {next(iter(values))}")
        return 0
    bad = [(rel, current) for rel, current in currents.items() if current != target]
    if bad:
        print(f"ERROR: version mismatch (expected {target}):")
        for rel, current in bad:
            print(f"  {rel}: {current}")
        return 1
    print(f"OK: all {len(LOCATIONS)} locations at {target}")
    return 0


def cmd_bump(target: str, dry_run: bool) -> int:
    """Rewrite every location not already at *target*. All-or-nothing: every
    replacement is computed and validated in memory before any file is written."""
    plan: list[tuple[Location, str, str]] = []
    for loc in LOCATIONS:
        current = _read_current(loc)
        if current == target:
            continue
        path = REPO / loc.rel
        text = path.read_text(encoding="utf-8")
        new_text = loc.pattern.sub(partial(_repl, target), text, count=1)
        new_matches = loc.pattern.findall(new_text)
        if len(new_matches) != 1 or new_matches[0] != target:
            sys.exit(f"ERROR: post-rewrite validation failed for {loc.rel}")
        plan.append((loc, current, new_text))
    if not plan:
        print(f"All locations already at {target}; nothing to do.")
        return 0
    label = "dry-run" if dry_run else "write"
    count = len(plan)
    print(f"Bump {plan[0][1]} -> {target} ({label}, {count} file{'s' if count != 1 else ''}):")
    for loc, current, _ in plan:
        print(f"  {loc.rel}: {current} -> {target}")
    if dry_run:
        return 0
    for loc, _, new_text in plan:
        (REPO / loc.rel).write_text(new_text, encoding="utf-8")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bump or check the project version across synchronized locations.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="verify locations agree (CI-friendly)")
    mode.add_argument("--dry-run", action="store_true", help="print changes without writing")
    parser.add_argument(
        "version",
        nargs="?",
        help="target version (strict x.y.z); optional with --check (omitted = cross-check)",
    )
    args = parser.parse_args()

    if args.check:
        if args.version is not None and not SEMVER.match(args.version):
            sys.exit(f"ERROR: '{args.version}' is not x.y.z (strict digits only)")
        sys.exit(cmd_check(args.version))

    if args.version is None:
        parser.error("version is required for bump / --dry-run (e.g. 0.23.0)")
    if not SEMVER.match(args.version):
        sys.exit(f"ERROR: '{args.version}' is not x.y.z (strict digits only)")
    sys.exit(cmd_bump(args.version, args.dry_run))


if __name__ == "__main__":
    main()
