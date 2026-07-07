import importlib.metadata
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).parent.parent.resolve()
_DEFAULT_DB_PATH = _BACKEND_DIR / "visualizer.db"


def _resolve_version() -> str:
    """Derive the backend version from installed package metadata (DOC-007).

    Avoids the drift a hardcoded VERSION caused. Falls back to a sentinel when
    the distribution is not installed so OpenAPI docs still render.
    """
    try:
        return importlib.metadata.version("claude-office-visualizer")
    except importlib.metadata.PackageNotFoundError:
        return "0.0.0+local"


class Settings(BaseSettings):
    PROJECT_NAME: str = "Claude Office Visualizer"
    VERSION: str = _resolve_version()
    API_V1_STR: str = "/api/v1"

    BACKEND_CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://0.0.0.0:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

    DATABASE_URL: str = f"sqlite+aiosqlite:///{_DEFAULT_DB_PATH}"
    GIT_POLL_INTERVAL: int = 5

    CLAUDE_CODE_OAUTH_TOKEN: str = ""
    SUMMARY_MODEL: str = "claude-haiku-4-5-20251001"
    SUMMARY_ENABLED: bool = True
    SUMMARY_MAX_TOKENS: int = 1000

    CLAUDE_PATH_HOST: str = ""
    CLAUDE_PATH_CONTAINER: str = ""

    # When a subagent's transcript stays inactive for more than this many
    # seconds, the transcript poller assumes the agent crashed (rate-limit,
    # interruption, ...) and emits a synthetic SubagentStop so the office
    # visualizer can clean it up. A regular agent makes a tool-call every
    # few seconds, so 90s is comfortably above the noise floor while still
    # catching zombies quickly.
    ZOMBIE_SUBAGENT_TIMEOUT_SECONDS: int = 90

    # API key for authenticating hook requests. When set, all requests
    # must include this value in the X-API-Key header. When empty, a
    # per-launch random token is generated for state-changing endpoints
    # and WebSocket non-browser connections.
    CLAUDE_OFFICE_API_KEY: str = ""

    # Auto-generated per-launch token. Used as the effective API key when
    # CLAUDE_OFFICE_API_KEY is not explicitly set. This ensures state-changing
    # endpoints always require an API key even in the default configuration.
    _auto_api_key: str = secrets.token_hex(32)

    # Rich tracebacks render local variables and full filesystem paths into logs.
    # Useful in development; disable for shared/production deployments (SEC-006).
    LOG_RICH_TRACEBACKS: bool = True

    @property
    def effective_api_key(self) -> str:
        """Return the configured API key, or the per-launch auto-generated token."""
        return self.CLAUDE_OFFICE_API_KEY or self._auto_api_key

    @property
    def has_explicit_key(self) -> bool:
        """True when the user explicitly set CLAUDE_OFFICE_API_KEY."""
        return bool(self.CLAUDE_OFFICE_API_KEY)

    model_config = SettingsConfigDict(env_file=".env")

    def translate_path(self, path: str) -> str:
        """Translate host path to container path for Docker deployments.

        If CLAUDE_PATH_HOST and CLAUDE_PATH_CONTAINER are set, replaces the
        host prefix with the container prefix. Otherwise returns path unchanged.

        Args:
            path: File path to translate (e.g., transcript_path from hooks)

        Returns:
            Translated path for the current environment
        """
        if (
            self.CLAUDE_PATH_HOST
            and self.CLAUDE_PATH_CONTAINER
            and path.startswith(self.CLAUDE_PATH_HOST)
        ):
            return path.replace(self.CLAUDE_PATH_HOST, self.CLAUDE_PATH_CONTAINER, 1)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()
