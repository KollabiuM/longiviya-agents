"""Fail-safe tests for the hooks config installer (ARC-008).

Covers the three behaviors added in the hardening:
- malformed ``settings.json`` aborts installation instead of wiping it,
- writes are atomic (temp file + ``os.replace``) with no ``.tmp`` left behind,
- the first mutation of an existing file is backed up to ``settings.json.bak``.
"""

import json
from pathlib import Path

import pytest

import manage_hooks


def _settings_path(tmp_path: Path) -> Path:
    return tmp_path / "settings.json"


def test_load_settings_aborts_on_invalid_json(tmp_path: Path) -> None:
    """A malformed settings.json must raise SystemExit, not return {}."""
    path = _settings_path(tmp_path)
    path.write_text("{ not json ", encoding="utf-8")

    with pytest.raises(SystemExit) as exc:
        manage_hooks.load_settings(path)

    assert "not valid JSON" in str(exc.value)
    # The corrupt original must be left byte-for-byte intact.
    assert path.read_text(encoding="utf-8") == "{ not json "


def test_install_aborts_on_invalid_json_without_touching_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End-to-end: install into a malformed settings.json aborts before any write."""
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path))
    path = _settings_path(tmp_path)
    original = "{ broken"
    path.write_text(original, encoding="utf-8")

    with pytest.raises(SystemExit):
        manage_hooks.install_hooks("/usr/local/bin/claude-office-hook")

    # File untouched, no backup or temp artifacts created.
    assert path.read_text(encoding="utf-8") == original
    assert not (tmp_path / "settings.json.bak").exists()
    assert not (tmp_path / "settings.json.tmp").exists()


def test_save_settings_is_atomic_and_creates_backup(tmp_path: Path) -> None:
    """Saving over an existing file: backup created once, unrelated keys preserved."""
    path = _settings_path(tmp_path)
    path.write_text(json.dumps({"model": "opus", "permissions": {}}), encoding="utf-8")

    manage_hooks.save_settings(path, {"model": "opus", "permissions": {}, "hooks": {}})

    # New content written and parseable; unrelated key preserved.
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["model"] == "opus"
    # First-mutation backup captured the pre-write original.
    backup = tmp_path / "settings.json.bak"
    assert backup.exists()
    assert json.loads(backup.read_text(encoding="utf-8"))["model"] == "opus"
    # No temp file left behind.
    assert not (tmp_path / "settings.json.tmp").exists()


def test_save_settings_preserves_oldest_backup_across_runs(tmp_path: Path) -> None:
    """A second run must not overwrite the first-run ``.bak`` snapshot."""
    path = _settings_path(tmp_path)
    backup = tmp_path / "settings.json.bak"

    path.write_text(json.dumps({"v": 1}), encoding="utf-8")
    manage_hooks.save_settings(path, {"v": 2})
    first_backup = backup.read_text(encoding="utf-8")
    assert json.loads(first_backup)["v"] == 1

    path.write_text(json.dumps({"v": 999}), encoding="utf-8")
    manage_hooks.save_settings(path, {"v": 3})
    # Backup still holds the original v=1 snapshot, not v=999.
    assert json.loads(backup.read_text(encoding="utf-8"))["v"] == 1


def test_load_settings_returns_empty_for_missing_file(tmp_path: Path) -> None:
    """A fresh install (no settings.json) is still allowed: returns {}."""
    assert manage_hooks.load_settings(_settings_path(tmp_path)) == {}
