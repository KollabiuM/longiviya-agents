"""WebSocket connection registry (domain layer).

``ConnectionManager`` owns the live ``WebSocket`` connections grouped by
session, room, and the cross-session overview feed. It lives in ``app/core``
(rather than ``app/api``) so that domain modules (``event_processor``,
``broadcast_service``, ``git_service``) can depend on it without importing
the transport layer -- this preserves the layering invariant established in
ARC-011.

Transport-specific concerns (origin allowlist, session-id format check,
handshake validators) stay in ``app/api/websocket.py``.
"""

import asyncio
import logging
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections grouped by session ID."""

    def __init__(self) -> None:
        self.active_connections: dict[str, list[WebSocket]] = {}
        self.room_connections: dict[str, list[WebSocket]] = {}
        self.overview_connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Generic broadcast helper
    # ------------------------------------------------------------------

    async def _broadcast_to_connections(
        self,
        message: dict[str, Any],
        connections: list[WebSocket],
        *,
        label: str = "session",
    ) -> list[WebSocket]:
        """Send a message to a list of WebSocket connections.

        Args:
            message: JSON-serializable payload to send.
            connections: Snapshot of connections to iterate.
            label: Context label included in failure log lines
                (e.g. session id, ``"overview"``, ``"all"``).

        Returns:
            The connections whose ``send_json`` call failed. The caller is
            responsible for pruning them from its own data structures so the
            helper stays agnostic of whether connections are grouped by
            session, room, or stored in a flat list (QA-015).
        """
        failed: list[WebSocket] = []
        for connection in connections:
            try:
                if connection.client_state == WebSocketState.CONNECTED:
                    await connection.send_json(message)
            except Exception as e:
                logger.warning("Failed to send to WebSocket (%s): %s", label, e)
                failed.append(connection)
        return failed

    # ------------------------------------------------------------------
    # Session-level operations
    # ------------------------------------------------------------------

    async def connect(self, websocket: WebSocket, session_id: str) -> None:
        """Accept a WebSocket connection and register it for a session."""
        await websocket.accept()
        async with self._lock:
            if session_id not in self.active_connections:
                self.active_connections[session_id] = []
            self.active_connections[session_id].append(websocket)

    async def disconnect(self, websocket: WebSocket, session_id: str) -> None:
        """Remove a WebSocket connection from a session."""
        async with self._lock:
            if session_id in self.active_connections:
                if websocket in self.active_connections[session_id]:
                    self.active_connections[session_id].remove(websocket)
                if not self.active_connections[session_id]:
                    del self.active_connections[session_id]

    async def broadcast(self, message: dict[str, Any], session_id: str) -> None:
        """Send a message to all WebSocket connections for a session."""
        async with self._lock:
            connections = self.active_connections.get(session_id, []).copy()

        if not connections:
            return

        failed = await self._broadcast_to_connections(message, connections, label=session_id)
        if failed:
            async with self._lock:
                group = self.active_connections.get(session_id)
                if group:
                    for conn in failed:
                        if conn in group:
                            group.remove(conn)
                    if not group:
                        del self.active_connections[session_id]

    async def send_personal_message(self, message: dict[str, Any], websocket: WebSocket) -> None:
        """Send a message to a specific WebSocket connection."""
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_json(message)
        except Exception as e:
            logger.warning("Failed to send personal message: %s", e)

    async def broadcast_all(self, message: dict[str, Any]) -> None:
        """Broadcast a message to ALL connected clients across all sessions."""
        async with self._lock:
            all_connections: list[tuple[str, WebSocket]] = []
            for session_id, connections in self.active_connections.items():
                for conn in connections:
                    all_connections.append((session_id, conn))

        if not all_connections:
            return

        failed = await self._broadcast_to_connections(
            message, [conn for _, conn in all_connections], label="all"
        )
        if failed:
            failed_ids = {id(conn) for conn in failed}
            async with self._lock:
                for session_id, conns in list(self.active_connections.items()):
                    pruned = [c for c in conns if id(c) not in failed_ids]
                    if pruned:
                        self.active_connections[session_id] = pruned
                    elif session_id in self.active_connections:
                        del self.active_connections[session_id]

    # ------------------------------------------------------------------
    # Room-level WebSocket support
    # ------------------------------------------------------------------

    async def connect_room(self, websocket: WebSocket, room_id: str) -> None:
        """Accept a WebSocket connection and register it for a room."""
        await websocket.accept()
        async with self._lock:
            if room_id not in self.room_connections:
                self.room_connections[room_id] = []
            self.room_connections[room_id].append(websocket)

    async def disconnect_room(self, websocket: WebSocket, room_id: str) -> None:
        """Remove a WebSocket connection from a room."""
        async with self._lock:
            if room_id in self.room_connections:
                if websocket in self.room_connections[room_id]:
                    self.room_connections[room_id].remove(websocket)
                if not self.room_connections[room_id]:
                    del self.room_connections[room_id]

    async def broadcast_room(self, message: dict[str, Any], room_id: str) -> None:
        """Send a message to all WebSocket connections for a room."""
        async with self._lock:
            connections = self.room_connections.get(room_id, []).copy()

        if not connections:
            return

        failed = await self._broadcast_to_connections(message, connections, label=room_id)
        if failed:
            async with self._lock:
                group = self.room_connections.get(room_id)
                if group:
                    for conn in failed:
                        if conn in group:
                            group.remove(conn)
                    if not group:
                        del self.room_connections[room_id]

    # ------------------------------------------------------------------
    # Overview-level WebSocket support (Command Center — cross-session)
    # ------------------------------------------------------------------

    async def connect_overview(self, websocket: WebSocket, *, max_connections: int) -> bool:
        """Accept a WebSocket connection and register it for the overview feed.

        Returns False (without accepting) when adding the connection would
        exceed ``max_connections``. The cap check and the append both run under
        the lock to close the TOCTOU window where a burst of concurrent
        handshakes each pass the limit before any registers.
        """
        async with self._lock:
            if len(self.overview_connections) >= max_connections:
                return False
            await websocket.accept()
            self.overview_connections.append(websocket)
            return True

    async def disconnect_overview(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection from the overview feed."""
        async with self._lock:
            if websocket in self.overview_connections:
                self.overview_connections.remove(websocket)

    async def broadcast_overview(self, message: dict[str, Any]) -> None:
        """Send a message to all WebSocket clients on the overview feed."""
        async with self._lock:
            connections = self.overview_connections.copy()

        if not connections:
            return

        failed = await self._broadcast_to_connections(message, connections, label="overview")
        if failed:
            failed_ids = {id(conn) for conn in failed}
            async with self._lock:
                self.overview_connections[:] = [
                    conn for conn in self.overview_connections if id(conn) not in failed_ids
                ]


manager = ConnectionManager()


def get_manager() -> ConnectionManager:
    """FastAPI-compatible dependency that returns the ConnectionManager singleton.

    Use via ``Depends(get_manager)`` in route handlers for testability.
    Tests can call ``override_manager(instance)`` to inject a mock.
    """
    return manager


def override_manager(instance: ConnectionManager) -> None:
    """Replace the module-level singleton with *instance* (for testing)."""
    global manager
    manager = instance
