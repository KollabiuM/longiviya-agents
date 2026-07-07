# Audit Remediation Report

> **Project**: Claude Office Visualizer (claude-office)
> **Audit Date**: 2026-07-06 (see [AUDIT.md](AUDIT.md) — 69 findings)
> **Remediation Date**: 2026-07-07
> **Severity Filter Applied**: `all` (continuation of the critical-gate run into all remaining tractable items)
> **Branch**: `fix/audit-remediation` (off prep commit `3414f7e` on `main`)
> **Companion guide**: [AUDIT_REMEDIATION.md](AUDIT_REMEDIATION.md) (underscore) — detailed per-issue playbook for the remaining items.

---

## TL;DR

**37 of 69 issues fully resolved + SEC-005 partial**, across 10 verified commits on `fix/audit-remediation`. All four components are green: `make checkall` from root exits 0 (backend 321 tests, frontend 149, hooks 18, opencode-plugin 27). The critical CI/checkall gate (ARC-001/DOC-001/ARC-009), all security findings, all documentation findings, the backend blocking-I/O and dual-dispatch fixes, and a broad swath of code-quality work (incl. 108 new tests) landed. **31 items remain**, dominated by the deep god-object refactors the audit itself classes as *long-term/backlog* — those are deferred with justification below; the characterization tests they require are now in place.

---

## Execution Summary

| Wave | Status | Issues | Commit |
|------|--------|--------|--------|
| Critical gate (ARC-001, DOC-001, ARC-009) | ✅ | 3 | `38ac8e0` |
| Security (SEC-001/002/003/004/006) | ✅ | 5 | `fe5b2b0` |
| Documentation (DOC-002..006, DOC-008..016) | ✅ | 14 | `4b4827b` |
| ARC-008 hooks fail-safe | ✅ | 1 | `2eb859c` |
| ARC-003 blocking I/O off event loop | ✅ | 1 | `81d91cb` |
| ARC-002 dispatch consolidation (also resolves QA-004) | ✅ | 2 | `97d3af5` |
| QA-001 frontend characterization tests | ✅ | 1 | `f101346` |
| Minor batch (QA-008, ARC-022, DOC-007) | ✅ | 3 | `67e21b8` |
| ARC-016 + ARC-018 + QA-002 (bundled — see note) | ✅ | 3 | `1b041a0` |
| Frontend QA (QA-005/006/011/012) | ✅ | 4 | `c457404` |

**Totals**: 37 fully resolved · 1 partial (SEC-005) · 31 remaining. 108 new tests added (backend +1, frontend +76 then +32, hooks +5, plugin +27).

> **Bundled-commit note** (`1b041a0`): ARC-016 (backend), ARC-018 (frontend), and QA-002 (plugin) landed in one commit because the pre-commit hook typechecks *all* components per commit and the plugin's new `sessionTracker.ts` is coupled to `index.ts`'s `BackendEvent` export — staging them separately produces a transiently inconsistent tree under pre-commit's stash. The commit message documents all three; the changes are verified-correct together.

---

## Resolved Issues ✅

### Architecture (8)
- **ARC-001** — CI enforcement + root `checkall` runs tests across all 4 components + `scripts/` ruff; new `.github/workflows/ci.yml`.
- **ARC-002** — Collapsed the dual event dispatch (10 `if`-blocks) into a single `_post_broadcast_enrichers` table; replay/ordering preserved. *(Resolves QA-004.)*
- **ARC-003** — Wrapped blocking sync file I/O (incl. the 50 MB transcript read) in `asyncio.to_thread` at async boundaries; `transition()` kept sync for replay. Also fixed a missed call site in `event_processor._build_restored_state_machine`.
- **ARC-008** — Hooks installer is now fail-safe: aborts on `JSONDecodeError`, atomic temp-file+`os.replace` write, one-time `.bak`.
- **ARC-009** — Restored `TeamSimulationContext`; single `SCENARIOS` registry; `teams`/`quick` reachable.
- **ARC-016** — Per-session rate limiter (`session_id`-keyed, 1000/60s default in Settings, bounded memory) replacing the global bucket.
- **ARC-018** — Split `useWebSocketEvents` (579→276 lines) into `WebSocketController` + `stateReconciler` (pure `resolveSpawn`) + `typingTracker`.
- **ARC-022** — Removed unused `httpx2` dev dependency (+ transitives).

### Security (5 + 1 partial) — ⚠ all flagged for manual review
- **SEC-001** — `/api/v1/status` no longer returns the API key; delivered via console log + `?token=` launch URL → frontend `sessionStorage`.
- **SEC-002** — `POST /sessions/{id}/focus` (terminal activation + clipboard) now requires the key; closes paste-jacking/CSRF vector.
- **SEC-003** — Git invocations hardened (`core.fsmonitor=false`, `core.hooksPath=/dev/null`, `GIT_CONFIG_GLOBAL=/dev/null`); `project_root` validated.
- **SEC-004** — Docker API bound to `127.0.0.1:8000` (was all interfaces).
- **SEC-006** — `LOG_RICH_TRACEBACKS` setting; docker compose sets `=0`.
- **SEC-005 (partial)** — Backend decision: `/events` stays open by default and gated only when `CLAUDE_OFFICE_API_KEY` is set (forcing the auto-key would break producers with no discovery channel post-SEC-001); regression tests lock it in. **Plugin `X-API-Key` part now unblocked** by QA-002's injectable `SessionTracker` — small follow-up.

### Code Quality (8)
- **QA-001** — 76 frontend characterization tests (gameStore, astar, agentMachine) — the precondition for the frontend refactors.
- **QA-002** — opencode-plugin: `SessionTracker` class (injectable `sendEvent`), 27 tests, real ESLint.
- **QA-004** — Resolved by ARC-002 (dispatch consolidation).
- **QA-005** — Extracted `shouldShowToast` (pure) + (via ARC-018) `resolveSpawn`/`TypingTracker`.
- **QA-006** — Single-`set()` dequeue (no transient inconsistent state).
- **QA-008** — `_kill_simulation_process` logs + returns `False` on failure (was silent `pass`).
- **QA-011** — Stray `console.log` gated behind `debugMode`.
- **QA-012** — `updateAgentMeta` `||`→`??` (empty task now clears).

### Documentation (16)
- DOC-001 (checkall runs tests) · DOC-002 (`SERVE_STATIC`) · DOC-003 (API auth; corrected for SEC-001/002) · DOC-004 (Command Center) · DOC-005 (removed dead `summarize_tool_call` docs) · DOC-006 (env tables) · DOC-007 (`config.py` VERSION derived via `importlib.metadata`) · DOC-008/009 (link fixes) · DOC-010/011 (README inventory) · DOC-012 (plugin key limitation) · DOC-013 (PRD banner) · DOC-014 (root artifact cleanup) · DOC-015 (research index) · DOC-016 (consistency nits + CI badge).

---

## Deferred — Deep Refactors (audit's long-term/backlog; need dedicated effort) 🔧

These are the riskiest, highest-blast-radius items. The audit itself sequences them behind characterization tests and classes them as *long-term/backlog*. They are **not** safely one-shot-automatable; doing them blind would risk the exact desync/stuck-state bugs the project's history already hit. They are deferred deliberately, now that QA-001's tests exist to make them safer.

| ID | Title | Why deferred | Precondition |
|----|-------|--------------|--------------|
| **ARC-004 + ARC-017** | Single-writer agent-state ownership + break `machines`↔`systems` cycles | Largest single effort in the audit; redesigns queue ownership, removes the watchdog + 6× `setTimeout(0)` | QA-001 tests ✅ (in place) |
| **ARC-005** | Split `gameStore` into slices | Changes the store's public import surface | After ARC-004/017 |
| **ARC-006** | Frame-batched commits / imperative Pixi writes | Touches the 60fps render path | After ARC-004 |
| **ARC-014** | `EventData` discriminated union | Changes handler signatures across all of `core/handlers/*` | Independent; incremental possible |
| **ARC-011 + ARC-012** | Move `ConnectionManager` out of API layer + real DI seams | Backend structural; SEC-003 hardening on `git_service.py` must be preserved | SEC-003 ✅ (in place) |
| **QA-003** | `gameStore` dedup (`patchAgent`) | After ARC-005 | ARC-005 |
| **QA-007** | Remove `StateMachine` alias block | After ARC-014 | ARC-014 |
| **QA-009** | Replace `setTimeout(0)` ordering | Inside ARC-004/017 | ARC-004/017 |

---

## Remaining — Medium / Low (follow-up session) 📋

Not yet addressed; each is independently tractable (no deep-refactor precondition):

- **Medium**: ARC-010 (event contract test — backend↔hooks↔plugin), ARC-013 (`BasePoller` framework), ARC-015 (bounded growth / broadcast hot spots), ARC-020 (remote-backend policy), ARC-021/QA-010 (version-bump automation), QA-014 (WebSocket origin allowlist from settings), SEC-005 plugin part (now unblocked).
- **Low**: ARC-019 (`gen_types` introspection), ARC-023 (`main.py` split), ARC-024 (exception handler), ARC-025/QA-007 alias block, ARC-026 (StrictMode), ARC-027 (dep pinning), ARC-028 (component layout), ARC-029 (`install.sh` read-modify-write), ARC-030 (orphan `desktop/`/`tui/`), ARC-031 (dead guard — mostly done), QA-013 (magic numbers), QA-015 (broadcast helper), QA-016 (God-component split).

---

## Requires Manual Intervention 🔧

1. **Remote CI run not verified** — `.github/workflows/ci.yml` is YAML-valid locally but hasn't run on GitHub Actions (no push during remediation). Push the branch / open a PR and watch with `gh run watch`.
2. **Security review** — SEC-001/002/003/004/006 are behavioral security changes; review before merge (key-delivery flow, focus gating, git hardening, docker bind, log scrubbing).
3. **SEC-005 plugin part** — add `X-API-Key` to `opencode-plugin` `sendEvent` (now a ~3-line change via QA-002's injectable `SessionTracker`).
4. **DOC-012** — optional GitHub tracking issue for plugin key support.
5. **DOC-014** — optional merge of `docs/archives/GEMINI_UPDATE.md` unique sections into the canonical research doc.
6. **Pre-existing `scripts/` typing** — `scripts/` is ruff-gated only (not pyright); latent typing in `send_event(data: dict)` remains and is out of scope (no effect on `make checkall`/CI).

---

## Verification Results

Final `make checkall` from repo root (branch `fix/audit-remediation`, HEAD `c457404`): **exit 0**.

| Component | Result |
|-----------|--------|
| `scripts/` ruff | All checks passed |
| Backend pyright | 0 errors, 0 warnings |
| Backend pytest | **321 passed** |
| Frontend vitest | **149 passed** (12 files) |
| Hooks pytest | **18 passed** |
| opencode-plugin | eslint + tsc + **27 bun tests** |

Backend regression/replay suites all green (state_machine, teams, simulation_pipeline, pr44_critical_regressions, subagent_linking). No pre-existing failures surfaced. The recurring Pyright "import could not be resolved" diagnostics from the editor are venv-less-LSP artifacts (the authoritative `uv run pyright` / `tsc` via `make checkall` is clean).

---

## Files Changed (summary)

10 commits, ~40 files modified/created across `backend/`, `frontend/`, `hooks/`, `opencode-plugin/`, `scripts/`, `Makefile`, `.github/workflows/ci.yml`, `docker-compose.yml`, and the docs. See `git log --oneline 3414f7e..HEAD` and the per-commit messages for the full breakdown.

---

## Next Steps

1. **Review the security changes** (SEC-001/002/003/004/006) before merge.
2. **Push / open a PR** and confirm the remote CI run goes green (`gh run watch`).
3. **SEC-005 plugin part** — the small follow-up now unblocked by QA-002.
4. **Tackle the deferred deep refactors** in a dedicated session, in dependency order: QA-001 (done) → ARC-004/017 → ARC-005 → ARC-006 / QA-003 / QA-009 (frontend); ARC-014 → QA-007 (backend model); ARC-011 → ARC-012 (backend layering). The characterization tests make these far safer now.
5. **Mop up the medium/low items** (ARC-010/013/015, ARC-019..031, QA-013..016) — each independently tractable.
6. Re-run `/audit` afterward to get an updated AUDIT.md reflecting current state.
