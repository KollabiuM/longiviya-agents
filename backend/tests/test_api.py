import asyncio
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.event_processor import event_processor
from app.main import app
from app.models.events import EventAdapter, EventType

client = TestClient(app)


def _auth_headers() -> dict[str, str]:
    """Per-launch API key header required for state-changing endpoints.

    Session DELETE/PATCH are guarded by ``_is_state_changing`` even when no
    explicit key is configured, so these tests must present the auto-generated
    ``effective_api_key``.
    """
    return {"X-API-Key": get_settings().effective_api_key}


def _seed_session(session_id: str | None = None) -> str:
    """Create a session via the event pipeline and return its ID."""
    sid = session_id or f"test-{uuid4()}"
    event = EventAdapter.validate_python(
        {
            "event_type": EventType.SESSION_START,
            "session_id": sid,
            "timestamp": datetime.now(UTC),
            "data": {},
        }
    )
    asyncio.run(event_processor.process_event(event))
    return sid


def test_receive_event():
    response = client.post(
        "/api/v1/events",
        json={
            "event_type": "session_start",
            "session_id": "test_session",
            "timestamp": "2026-01-15T10:00:00",
            "data": {},
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"


def test_event_rate_limiter_is_per_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """ARC-016: ingestion rate limit keys by session_id, not globally.

    One busy session hitting its limit must not throttle a different,
    concurrent session. The previous single global deque throttled the
    wrong dimension and silently dropped events from unrelated sessions
    (hooks do not retry on 429).
    """
    from app.api.routes import events
    from app.config import Settings

    limit = 3
    test_settings = Settings(EVENT_RATE_LIMIT=limit)
    monkeypatch.setattr(events, "get_settings", lambda: test_settings)
    events.reset_rate_limiter()

    def post(session_id: str) -> int:
        return client.post(
            "/api/v1/events",
            json={
                "event_type": "session_start",
                "session_id": session_id,
                "data": {},
            },
        ).status_code

    # Session A fills its own bucket up to the limit.
    for _ in range(limit):
        assert post("sess-a") == 200
    # Session A is now throttled at its own bucket.
    assert post("sess-a") == 429
    # Session B has a separate bucket and is unaffected — the core
    # per-session property the fix restores.
    assert post("sess-b") == 200


def test_delete_single_session():
    session_id = _seed_session()

    list_response = client.get("/api/v1/sessions")
    assert list_response.status_code == 200
    assert any(session["id"] == session_id for session in list_response.json())

    delete_response = client.delete(f"/api/v1/sessions/{session_id}", headers=_auth_headers())
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "success"

    list_after_delete = client.get("/api/v1/sessions")
    assert list_after_delete.status_code == 200
    assert session_id not in [session["id"] for session in list_after_delete.json()]


def test_update_session_label():
    """PATCH /sessions/{id}/label should persist and return the label."""
    session_id = _seed_session()

    # Update label
    response = client.patch(
        f"/api/v1/sessions/{session_id}/label",
        json={"label": "My Test Session"},
        headers=_auth_headers(),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Verify label appears in session list
    list_response = client.get("/api/v1/sessions")
    assert list_response.status_code == 200
    session = next(s for s in list_response.json() if s["id"] == session_id)
    assert session["label"] == "My Test Session"


def test_update_session_label_clear():
    """PATCH /sessions/{id}/label with null should clear the label."""
    session_id = _seed_session()

    # Set a label first
    client.patch(
        f"/api/v1/sessions/{session_id}/label",
        json={"label": "temporary"},
        headers=_auth_headers(),
    )

    # Clear it
    response = client.patch(
        f"/api/v1/sessions/{session_id}/label",
        json={"label": None},
        headers=_auth_headers(),
    )
    assert response.status_code == 200

    list_response = client.get("/api/v1/sessions")
    session = next(s for s in list_response.json() if s["id"] == session_id)
    assert session["label"] is None


def test_update_session_label_not_found():
    """PATCH /sessions/{id}/label should return 404 for unknown session."""
    response = client.patch(
        "/api/v1/sessions/nonexistent-session/label",
        json={"label": "test"},
        headers=_auth_headers(),
    )
    assert response.status_code == 404


def test_session_list_includes_label_field():
    """All sessions in the list response should include a label field."""
    session_id = _seed_session()

    list_response = client.get("/api/v1/sessions")
    assert list_response.status_code == 200
    session = next(s for s in list_response.json() if s["id"] == session_id)
    assert "label" in session
