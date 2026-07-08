"""Tests for summary service fallback methods and pluggable backends."""

# pyright: reportPrivateUsage=false

import asyncio
import shutil
from collections.abc import Awaitable, Callable
from types import SimpleNamespace

import httpx
import pytest

from app.core.summary_service import SummaryService


@pytest.fixture
def service() -> SummaryService:
    """Create a summary service instance with AI disabled.

    Forced disabled so fallback paths are exercised deterministically,
    independent of whether a ``claude`` CLI happens to be on PATH on the host.
    """
    svc = SummaryService()
    svc.enabled = False
    return svc


class TestExtractFirstSentence:
    """Tests for _extract_first_sentence method."""

    def test_empty_text_returns_empty(self, service: SummaryService) -> None:
        """Empty text should return empty string."""
        assert service._extract_first_sentence("") == ""

    def test_single_sentence_returned(self, service: SummaryService) -> None:
        """Single sentence should be returned with punctuation."""
        text = "This is a test sentence."
        assert service._extract_first_sentence(text) == "This is a test sentence."

    def test_first_sentence_extracted(self, service: SummaryService) -> None:
        """First sentence should be extracted from multi-sentence text."""
        text = "First sentence here. Second sentence follows. Third too."
        assert service._extract_first_sentence(text) == "First sentence here."

    def test_long_sentence_truncated(self, service: SummaryService) -> None:
        """Long sentences should be truncated."""
        text = "This is a very " + "long " * 50 + "sentence."
        result = service._extract_first_sentence(text, max_len=50)
        assert len(result) <= 50
        assert result.endswith("...")

    def test_exclamation_as_sentence_end(self, service: SummaryService) -> None:
        """Exclamation mark should end a sentence."""
        text = "Hello there! More text follows."
        assert service._extract_first_sentence(text) == "Hello there!"

    def test_question_as_sentence_end(self, service: SummaryService) -> None:
        """Question mark should end a sentence."""
        text = "What is this? Here is the answer."
        assert service._extract_first_sentence(text) == "What is this?"

    def test_min_sentence_length(self, service: SummaryService) -> None:
        """Very short sentences (< 10 chars) should not be cut off."""
        text = "Hi. This is the actual first real sentence."
        # "Hi." is only 3 chars, so it should continue to find a proper sentence
        result = service._extract_first_sentence(text)
        # Should include more than just "Hi."
        assert len(result) > 10 or result == text[:50]


class TestGenerateAgentNameFallback:
    """Tests for generate_agent_name_fallback method."""

    def test_empty_description_returns_intern(self, service: SummaryService) -> None:
        """Empty description should return 'The Intern'."""
        assert service.generate_agent_name_fallback("") == "The Intern"

    def test_test_task_gets_test_name(self, service: SummaryService) -> None:
        """Test-related tasks should get test-themed names."""
        result = service.generate_agent_name_fallback("Run the test suite")
        assert result in ["Test Pilot", "Dr. Test", "QA Queen", "Bug Buster", "Test Dummy"]

    def test_review_task_gets_review_name(self, service: SummaryService) -> None:
        """Review/QA tasks should get judge-themed names."""
        result = service.generate_agent_name_fallback("Review the pull request")
        assert result in ["Judge Judy", "The Critic", "Hawkeye", "Inspector G", "The Auditor"]

    def test_clean_task_gets_cleaner_name(self, service: SummaryService) -> None:
        """Cleaning tasks should get cleaner-themed names."""
        result = service.generate_agent_name_fallback("Clean up the code")
        assert result in ["The Cleaner", "Mr. Clean", "Tidy Bot", "Neat Freak"]

    def test_debug_task_gets_debug_name(self, service: SummaryService) -> None:
        """Debug tasks should get detective-themed names."""
        result = service.generate_agent_name_fallback("Debug the authentication issue")
        assert result in ["Bug Hunter", "Dr. Debug", "Sherlock", "The Debugger"]

    def test_fix_task_gets_fixer_name(self, service: SummaryService) -> None:
        """Fix tasks should get fixer-themed names."""
        result = service.generate_agent_name_fallback("Fix the broken authentication")
        assert result in ["The Fixer", "Patch Adams", "Mr. Fixit", "Bug Squasher"]

    def test_doc_task_gets_writer_name(self, service: SummaryService) -> None:
        """Documentation tasks should get writer-themed names."""
        result = service.generate_agent_name_fallback("Update the documentation")
        assert result in ["The Scribe", "Doc Brown", "Word Wizard", "Note Taker"]

    def test_format_task_gets_style_name(self, service: SummaryService) -> None:
        """Formatting tasks should get style-themed names."""
        result = service.generate_agent_name_fallback("Format the code with prettier")
        assert result in ["Style Guru", "Format King", "Lint Lord", "Pretty Boy"]

    def test_research_task_gets_scout_name(self, service: SummaryService) -> None:
        """Research tasks should get explorer-themed names."""
        result = service.generate_agent_name_fallback("Research the best approach")
        assert result in ["The Scout", "Explorer X", "Data Digger", "Researcher R"]

    def test_unknown_task_gets_generic_name(self, service: SummaryService) -> None:
        """Unknown tasks should get a generic fun name."""
        result = service.generate_agent_name_fallback("Do something random")
        generic_names = [
            "Code Cadet",
            "Bit Buddy",
            "Logic Larry",
            "Algo Al",
            "Helper Bot",
            "Task Force",
            "Agent X",
            "The Intern",
            "Worker Bee",
            "Minion",
        ]
        assert result in generic_names

    def test_name_is_not_empty(self, service: SummaryService) -> None:
        """Names should never be empty."""
        result = service.generate_agent_name_fallback("   ")
        assert result == "The Intern"


class TestDetectReportRequestFallback:
    """Tests for detect_report_request keyword fallback."""

    @pytest.mark.asyncio
    async def test_empty_prompt_returns_false(self, service: SummaryService) -> None:
        """Empty prompt should return False."""
        assert await service.detect_report_request("") is False

    @pytest.mark.asyncio
    async def test_report_keyword_detected(self, service: SummaryService) -> None:
        """Report-related keywords should be detected."""
        assert await service.detect_report_request("Create a report") is True
        assert await service.detect_report_request("Update the readme") is True
        assert await service.detect_report_request("Write documentation") is True

    @pytest.mark.asyncio
    async def test_md_file_pattern_detected(self, service: SummaryService) -> None:
        """Patterns like 'create X.md' should be detected."""
        assert await service.detect_report_request("Create README.md") is True
        assert await service.detect_report_request("Update the ARCHITECTURE.md") is True
        assert await service.detect_report_request("Write CHANGELOG.md") is True

    @pytest.mark.asyncio
    async def test_non_report_returns_false(self, service: SummaryService) -> None:
        """Non-report requests should return False."""
        assert await service.detect_report_request("Fix the bug") is False
        assert await service.detect_report_request("Add unit tests") is False
        assert await service.detect_report_request("Refactor the code") is False

    @pytest.mark.asyncio
    async def test_case_insensitive(self, service: SummaryService) -> None:
        """Detection should be case-insensitive."""
        assert await service.detect_report_request("CREATE A REPORT") is True
        assert await service.detect_report_request("Write a README") is True


class TestSummarizeUserPrompt:
    """Tests for summarize_user_prompt method."""

    @pytest.mark.asyncio
    async def test_empty_prompt_returns_empty(self, service: SummaryService) -> None:
        """Empty prompt should return empty string."""
        assert await service.summarize_user_prompt("") == ""

    @pytest.mark.asyncio
    async def test_short_prompt_returned_as_is(self, service: SummaryService) -> None:
        """Short single-sentence prompts should be returned as-is."""
        prompt = "Fix the login bug."
        result = await service.summarize_user_prompt(prompt)
        assert result == prompt

    @pytest.mark.asyncio
    async def test_newlines_normalized(self, service: SummaryService) -> None:
        """Newlines should be collapsed to spaces."""
        prompt = "First line\nSecond line\r\nThird line"
        result = await service.summarize_user_prompt(prompt)
        assert "\n" not in result
        assert "\r" not in result

    @pytest.mark.asyncio
    async def test_whitespace_collapsed(self, service: SummaryService) -> None:
        """Multiple whitespace should be collapsed."""
        prompt = "Too    many     spaces"
        result = await service.summarize_user_prompt(prompt)
        assert "  " not in result


# ---------------------------------------------------------------------------
# Pluggable backend tests (claude-cli subprocess + openai-compatible httpx).
# ---------------------------------------------------------------------------


def _fake_settings(**overrides: object) -> SimpleNamespace:
    """Build a Settings-like object exposing the fields the runners read."""
    base: dict[str, object] = {
        "SUMMARY_BACKEND": "claude-cli",
        "SUMMARY_ENABLED": True,
        "SUMMARY_MODEL": "claude-haiku-4-5-20251001",
        "SUMMARY_MAX_TOKENS": 1000,
        "SUMMARY_CONCURRENCY": 4,
        "SUMMARY_CLI_PATH": "claude",
        "SUMMARY_CLI_TIMEOUT": 15.0,
        "SUMMARY_OPENAI_BASE_URL": "https://example.test/v1",
        "SUMMARY_OPENAI_API_KEY": "k",
        "SUMMARY_OPENAI_MODEL": "gpt-4o-mini",
        "SUMMARY_OPENAI_TIMEOUT": 15.0,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeProc:
    """Minimal stand-in for asyncio.subprocess.Process."""

    def __init__(self, stdout: bytes = b"", returncode: int = 0) -> None:
        self._stdout = stdout
        self.returncode = returncode

    async def communicate(self) -> tuple[bytes, bytes]:
        return self._stdout, b""

    async def wait(self) -> int:
        return self.returncode

    def kill(self) -> None:
        self.returncode = -9


class _SlowProc(_FakeProc):
    """A process whose communicate() outlasts the configured timeout."""

    async def communicate(self) -> tuple[bytes, bytes]:
        await asyncio.sleep(10)
        return b"", b""


def _exec_returning(proc: _FakeProc) -> Callable[..., Awaitable[_FakeProc]]:
    """Build a stand-in for asyncio.create_subprocess_exec that resolves to *proc*."""

    async def _exec(*args: object, **kwargs: object) -> _FakeProc:
        return proc

    return _exec


def _which_none(*args: object, **kwargs: object) -> None:
    """Stand-in for shutil.which that reports the binary as missing."""
    return None


class TestClaudeCliBackend:
    """Tests for the claude-cli subprocess backend (_run_cli)."""

    @pytest.mark.asyncio
    async def test_success_returns_stdout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.core.summary_service.get_settings", lambda: _fake_settings())
        monkeypatch.setattr(
            asyncio,
            "create_subprocess_exec",
            _exec_returning(_FakeProc(b"Short summary")),
        )
        svc = SummaryService()
        svc.enabled = True
        svc._backend = "claude-cli"
        assert await svc._call_with_retry("prompt") == "Short summary"

    @pytest.mark.asyncio
    async def test_empty_stdout_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.core.summary_service.get_settings", lambda: _fake_settings())
        monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec_returning(_FakeProc(b"")))
        svc = SummaryService()
        svc.enabled = True
        svc._backend = "claude-cli"
        assert await svc._call_with_retry("prompt", max_retries=0) is None

    @pytest.mark.asyncio
    async def test_timeout_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "app.core.summary_service.get_settings",
            lambda: _fake_settings(SUMMARY_CLI_TIMEOUT=0.01),
        )
        monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec_returning(_SlowProc()))
        svc = SummaryService()
        svc.enabled = True
        svc._backend = "claude-cli"
        assert await svc._call_with_retry("prompt", max_retries=0) is None

    def test_missing_binary_disables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(shutil, "which", _which_none)
        monkeypatch.setattr("app.core.summary_service.get_settings", lambda: _fake_settings())
        assert SummaryService().enabled is False


class _FakeResponse:
    """Stand-in for an httpx.Response."""

    def __init__(self, payload: dict[str, object] | None = None) -> None:
        # payload=None signals an HTTP error (raise_for_status raises).
        self._payload = payload

    def raise_for_status(self) -> None:
        if self._payload is None:
            raise httpx.HTTPError("simulated server error")

    def json(self) -> dict[str, object]:
        return self._payload or {}


class _FakeAsyncClient:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def post(self, *args: object, **kwargs: object) -> _FakeResponse:
        return self._response


def _client_returning(client: _FakeAsyncClient) -> Callable[..., _FakeAsyncClient]:
    """Build a stand-in for the httpx.AsyncClient constructor returning *client*."""

    def _client(*args: object, **kwargs: object) -> _FakeAsyncClient:
        return client

    return _client


class TestOpenAiBackend:
    """Tests for the OpenAI-compatible httpx backend (_run_openai)."""

    @pytest.mark.asyncio
    async def test_success_parses_content(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.core.summary_service.get_settings", lambda: _fake_settings())
        monkeypatch.setattr(
            httpx,
            "AsyncClient",
            _client_returning(
                _FakeAsyncClient(
                    _FakeResponse({"choices": [{"message": {"content": "OpenAI summary"}}]})
                )
            ),
        )
        svc = SummaryService()
        svc.enabled = True
        svc._backend = "openai"
        assert await svc._call_with_retry("prompt", max_retries=0) == "OpenAI summary"

    @pytest.mark.asyncio
    async def test_http_error_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.core.summary_service.get_settings", lambda: _fake_settings())
        monkeypatch.setattr(
            httpx,
            "AsyncClient",
            _client_returning(_FakeAsyncClient(_FakeResponse(None))),
        )
        svc = SummaryService()
        svc.enabled = True
        svc._backend = "openai"
        assert await svc._call_with_retry("prompt", max_retries=0) is None

    @pytest.mark.asyncio
    async def test_empty_choices_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.core.summary_service.get_settings", lambda: _fake_settings())
        monkeypatch.setattr(
            httpx,
            "AsyncClient",
            _client_returning(_FakeAsyncClient(_FakeResponse({"choices": []}))),
        )
        svc = SummaryService()
        svc.enabled = True
        svc._backend = "openai"
        assert await svc._call_with_retry("prompt", max_retries=0) is None

    def test_unconfigured_disables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "app.core.summary_service.get_settings",
            lambda: _fake_settings(
                SUMMARY_BACKEND="openai", SUMMARY_OPENAI_BASE_URL="", SUMMARY_OPENAI_MODEL=""
            ),
        )
        assert SummaryService().enabled is False
