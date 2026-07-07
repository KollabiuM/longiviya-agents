import hmac
import re

from fastapi import WebSocket

# ``ConnectionManager`` and the ``manager`` singleton live in the domain layer
# (``app.core.connection_manager``) so that ``core/`` and ``services/`` need not
# import from ``app.api`` (ARC-011). They are re-exported here for backward
# compatibility with transport-level consumers (``app.main``, route handlers).
from app.core.connection_manager import (  # noqa: F401
    ConnectionManager as ConnectionManager,
)
from app.core.connection_manager import (
    get_manager as get_manager,
)
from app.core.connection_manager import (
    manager as manager,
)
from app.core.connection_manager import (
    override_manager as override_manager,
)

# Valid session/room IDs: alphanumeric, dashes, underscores only
_VALID_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")

# Origins permitted for WebSocket connections (localhost only)
_ALLOWED_WS_ORIGINS = frozenset(
    {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
)


def validate_websocket_origin(websocket: WebSocket) -> bool:
    """Check the Origin header on a WebSocket handshake.

    Browser connections must come from an allowed localhost origin.
    Non-browser connections (no Origin header) must present a valid
    X-API-Key matching the *effective* API key (either user-configured
    or the per-launch auto-generated token).  This prevents arbitrary
    local processes from subscribing to the session-state stream when
    no explicit key is configured.
    """
    origin = websocket.headers.get("origin")
    if origin is not None:
        return origin.rstrip("/") in _ALLOWED_WS_ORIGINS

    # Non-browser clients (no Origin) — always require the effective API key
    from app.config import get_settings

    key = get_settings().effective_api_key
    provided = websocket.headers.get("x-api-key", "")
    return hmac.compare_digest(provided, key)


def validate_session_id(session_id: str) -> bool:
    """Return True if *session_id* matches the expected format."""
    return bool(_VALID_ID_PATTERN.match(session_id))
