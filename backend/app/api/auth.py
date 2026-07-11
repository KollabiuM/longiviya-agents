"""Cookie-based login gate for the Agent Office (LNG-216-LOGIN).

Replaces the nginx basic-auth popup with a real HTML login page so nothing of
the office is visible before authentication. A single shared password lives in
``settings.AGENT_ADMIN_PASSWORD`` (env var only, never in code). The session
cookie is a stateless HMAC proof of knowing that password — no server-side
session store is needed.

* ``GET  /login``  -> render the login page
* ``POST /login``  -> verify password, set ``agent_session`` cookie, redirect ``/``
* ``GET  /logout`` -> clear the cookie, redirect ``/login``

The matching gate that redirects unauthenticated requests here lives in
``app.api.middleware.AuthMiddleware``. WebSocket handshakes are intentionally
not cookie-gated (the office JS that opens them only loads once the gated
page has been served); their existing Origin check is unchanged.
"""

import hashlib
import hmac
from pathlib import Path

from fastapi import APIRouter, Form
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from app.config import get_settings

router = APIRouter()

# Name of the signed session cookie set on successful login.
COOKIE_NAME = "agent_session"

# Fixed message signed with the admin password to derive the session token.
# Because the password is the HMAC key, only someone who knows it can produce
# a token that ``is_valid_session`` will accept.
_TOKEN_MESSAGE = b"agent_office_authenticated"

# 7-day cookie lifetime — long enough to avoid re-login churn, short enough to
# bound a leaked cookie's usefulness.
_COOKIE_MAX_AGE = 7 * 24 * 60 * 60

_TEMPLATE_PATH = Path(__file__).parent.parent.parent / "templates" / "login.html"
_ERROR_MARKER = "<!-- ERROR -->"
_ERROR_HTML = '<p class="error">Неверный пароль</p>'


def expected_token(password: str) -> str:
    """Derive the deterministic session token for *password* (HMAC-SHA256)."""
    return hmac.new(password.encode(), _TOKEN_MESSAGE, hashlib.sha256).hexdigest()


def is_valid_session(cookie_value: str | None) -> bool:
    """Return True if *cookie_value* is a valid session for the current password.

    Fails closed when the cookie is missing. When ``AGENT_ADMIN_PASSWORD`` is
    unset the gate is disabled upstream (``AuthMiddleware`` never calls this),
    so an empty password is treated as invalid here as a defensive backstop.
    """
    password = get_settings().AGENT_ADMIN_PASSWORD
    if not password or not cookie_value:
        return False
    return hmac.compare_digest(cookie_value, expected_token(password))


def _set_session_cookie(response: Response, token: str) -> None:
    """Attach the signed session cookie to *response* (HttpOnly, Secure, Lax)."""
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )


def render_login(error: bool = False) -> HTMLResponse:
    """Render the login page, optionally showing the wrong-password message."""
    html = _TEMPLATE_PATH.read_text(encoding="utf-8")
    html = html.replace(_ERROR_MARKER, _ERROR_HTML if error else "")
    return HTMLResponse(content=html)


@router.get("/login")
async def login_page() -> HTMLResponse:
    """Serve the login form."""
    return render_login()


@router.post("/login")
async def login_submit(password: str = Form(default="")) -> Response:
    """Verify the password; on success set the cookie and redirect to the office."""
    admin_password = get_settings().AGENT_ADMIN_PASSWORD
    if not admin_password or not hmac.compare_digest(password, admin_password):
        return render_login(error=True)

    response = RedirectResponse(url="/", status_code=303)
    _set_session_cookie(response, expected_token(admin_password))
    return response


@router.get("/logout")
async def logout() -> Response:
    """Clear the session cookie and send the user back to the login page."""
    response = RedirectResponse(url="/login", status_code=303)
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return response
