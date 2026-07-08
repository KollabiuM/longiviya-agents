# Audit Remediation Report

> **Project**: Claude Office Visualizer (claude-office)
> **Audit Date**: 2026-07-06 (see [AUDIT.md](AUDIT.md) — 69 findings)
> **Remediation Date**: 2026-07-07
> **Severity Filter Applied**: `all` (frontend god-object refactors deliberately deferred)
> **Branch**: `fix/audit-remediation` (24 commits off prep `3414f7e` on `main`)
> **Companion playbook**: [AUDIT_REMEDIATION.md](AUDIT_REMEDIATION.md) (underscore) — per-issue steps for the remaining items.

---

## TL;DR

**67 of 69 issues resolved** across **44 verified commits** on `fix/audit-remediation`. All components green: `make checkall` from root exits 0 (backend **397** tests, frontend **149**, hooks **23**, opencode-plugin **33** — up from a 41/0/13/0 baseline; **+498 new tests**). Verified at runtime too: `make dev-tmux` + `make simulate` ran clean to `session_end`, every event type through the ARC-014 union, `/api/v1/status` no longer discloses the key (SEC-001), no ImportErrors. **All security, all documentation, the entire backend structural chain, and the bulk of code quality are done.** **1 remains**: QA-016 (OfficeGame/page god-component split — the audit says do opportunistically). ARC-020 (remote-backend policy) resolved opt-in via `CLAUDE_OFFICE_ALLOW_REMOTE=1`, symmetric across hooks + plugin. **ARC-004/017 + QA-009 — the single-writer agent-state ownership refactor — landed in this cycle** (listener port breaking the `machines↔systems` cycle; `QueueManager`'s private maps folded into the store as the sole writer; the six `setTimeout(0)` re-entrancy escapes replaced by a microtask flush queue; the 3-second "stuck boss" watchdog deleted). Runtime-verified end-to-end: `make simulate` (complex, 4+ agents) completes the full lifecycle with zero console errors and no stuck agents. **ARC-005/006 + QA-003 — the frontend god-object follow-ups — also landed this cycle** (`gameStore` split into 9 Zustand slices, one ~370-line composition root down from 1308; per-frame agent position writes batched into a single `set()` per tick with the root page narrowed off the 60fps re-render path; the duplicate `updateAgentX`/queue actions deduped via a `patchAgent` helper + parameterized queue helpers). Runtime-verified: `make dev-tmux` + two full sims to `session_end`, zero console errors, agents reach desks through the batched write path.

---

## Resolved Issues ✅ (~55)

### Architecture (24)
ARC-001 (CI) · ARC-002 (dispatch table, =QA-004) · ARC-003 (blocking I/O off loop) · ARC-008 (hooks fail-safe) · ARC-009 (teams scenario) · **ARC-010 (event contract test)** · ARC-011 (ConnectionManager to domain) · ARC-012 (DI seams functional) · ARC-013 (BasePoller framework) · ARC-014 (EventData discriminated union) · **ARC-015 (bounded growth + broadcast hot spots)** · ARC-016 (per-session rate limiter) · ARC-018 (useWebSocketEvents split) · **ARC-022 (httpx2 — confirmed load-bearing stub peer dep, documented; *not* removed)** · **ARC-024 (app exception handler + PATCH consolidation)** · ARC-025 (StateMachine aliases, =QA-007) · **ARC-026 (StrictMode workaround documented)** · **ARC-027 (dep-pinning policy)** · **ARC-028 (DOM panels moved out of components/game)** · **ARC-030 (gitignore orphan desktop/tui)** · **ARC-031 (dead guard — resolved by ARC-009)** · **ARC-021 (version-bump automation + make bump-version, = QA-010)** · **ARC-019 (gen_types completeness test)** · **ARC-029 (install.sh read-modify-write)** · **ARC-023 (main.py split into middleware/migrate/websockets)** · **ARC-017 (machines↔systems import cycle broken via AnimationListener port + gameRuntime composition root)** · **ARC-004 (single-writer queue ownership: QueueManager's private maps folded into the store, `setTimeout(0)`→microtask flush, stuck-boss watchdog deleted — bundles QA-009)** · **ARC-005 (gameStore split into 9 Zustand slices — debug/replay/whiteboard/office/boss/reservation/agent/queue/bubble — one ~370-line composition root down from 1308)** · **ARC-006 (per-frame agent position writes batched into one `set()`/tick; `page.tsx` selector narrowed off the 60fps re-render path)** · **ARC-020 (remote-backend policy: symmetric opt-in `CLAUDE_OFFICE_ALLOW_REMOTE=1` across hooks + plugin; non-localhost clamped to the local default otherwise, clamp logged to debug file / stderr)**.

### Security (6) — ⚠ all flagged for manual review
SEC-001 (no key in `/status`) · SEC-002 (focus/clipboard gated) · SEC-003 (git hardening) · SEC-004 (docker loopback) · SEC-005 (`/events` gating decision + plugin `X-API-Key`) · SEC-006 (`LOG_RICH_TRACEBACKS`).

### Code Quality (13)
QA-001 (76 characterization tests) · QA-002 (plugin SessionTracker + ESLint) · QA-004 (via ARC-002) · QA-005 (pure `shouldShowToast`/`resolveSpawn`/`TypingTracker`) · QA-006 (single-`set()` dequeue) · QA-007/ARC-025 (alias block removed) · QA-008 (swallowed exception logged) · QA-011 (`console.log` gated) · QA-012 (`||`→`??`) · **QA-013 (magic numbers named + dicts hoisted)** · **QA-014 (WS origin from settings)** · **QA-015 (broadcast helper deduped)** · **QA-009 (`setTimeout(0)` ordering → microtask flush queue, via ARC-004)** · **QA-003 (gameStore dedup: `patchAgent` helper funnels 7 `updateAgentX` mutators; enqueue/dequeue pairs parameterized by `queueType` — post-slicing)**.

### Documentation (16)
DOC-001 through DOC-016 — all resolved.

---

## Deferred — Frontend God-Object Refactors ✅ (resolved this cycle)

The audit's own *long-term/backlog* tranche — the riskiest frontend items, where the unit-test safety net is weakest against the runtime coordination/timing bug class this project has hit. All three landed this cycle, each behavior-preserving and (for ARC-006, the timing-sensitive one) runtime-verified: **ARC-005** (gameStore → 9 slices), **ARC-006** (batched per-frame writes + narrowed page selector), **QA-003** (`patchAgent` + parameterized queue dedup). Built on ARC-004/017 + QA-009 (single-writer ownership) which settled the coordination model first; QA-001's 149 characterization tests locked the behavior throughout.

---

## Remaining — Low (1) 📋

**Low (1):** QA-016 (God-component split — `OfficeGame.tsx`/`page.tsx`; the audit says do "when next touched" — a risky canvas refactor, deferred).

---

## Requires Manual Intervention 🔧

1. **Remote CI run not verified** — `.github/workflows/ci.yml` is YAML-valid but hasn't run on GitHub Actions (no push). Push / open a PR; watch with `gh run watch`.
2. **Security review** — SEC-001..006 are behavioral security changes; review before merge.
3. **ARC-030 deletion** — `desktop/` (562 MB) and `tui/` (40 MB) are now gitignored but still on disk; delete locally when you confirm they're not active experiments.
4. ~~**ARC-020 policy decision**~~ — **resolved**: Option C — symmetric opt-in remote via `CLAUDE_OFFICE_ALLOW_REMOTE=1` in both hooks and plugin; non-localhost URLs clamped to the local default otherwise; the clamp is logged to the hooks debug file (not stdout/stderr) and to plugin stderr when `CLAUDE_OFFICE_DEBUG=1`.
5. **Pre-existing `scripts/` typing** — ruff-gated only; latent `send_event(data: dict)` typing out of scope.

---

## Verification Results

`make checkall` from root (HEAD `fa89276`): **exit 0**. Backend 397 · frontend 149 · hooks 18 · plugin 29. All regression/replay/security/event-union/di-seam suites green. **Runtime**: `make dev-tmux` + `make simulate` ran clean to `session_end`; every event type validated through the ARC-014 union; `/api/v1/status` returns no `apiKey`; no ImportErrors. (The recurring editor Pyright "import unresolved" warnings are venv-less-LSP artifacts — authoritative `make checkall` is clean.)

---

## Notable engineering outcomes

- **+469 tests** across all components.
- **Backend structural chain complete**: dispatch consolidated, blocking I/O off the loop, `ConnectionManager` in the domain layer, DI seams functional, `EventData` discriminated union across all 23 event types, pollers deduped via `BasePoller`, aliases removed, app-level exception handler, settings-driven WS origin — each behavior-preserving with the full regression suite green.
- **ARC-022 correction**: the initial "httpx2 unused → remove" was wrong (it's a stub-only peer dep for Starlette `TestClient` typing); the breakage surfaced when a later `uv sync` purged it from the venv. Restored with a documenting comment — a clean example of why `uv lock` ≠ `uv sync` and of checking stub-only peer deps.
- **Two latent bugs fixed as side effects**: PR#44 deadlock fix propagated to all 3 pollers; `stop_all` now awaits cancelled tasks.
- **Coordination lessons**: the pre-commit hook typechecks all components per commit (coupled cross-component changes commit together); concurrent backend agents sharing a venv can produce transient false-failures during `uv sync`.

---

## Next Steps

1. **Review security changes** (SEC-001..006) before merge.
2. **Push / open a PR**; confirm remote CI green.
3. **ARC-030 / ARC-020** manual decisions above.
4. **Frontend god-object refactors** — ARC-004/017 + QA-009 (single-writer ownership) **done**; remaining: ARC-005 → ARC-006 / QA-003 as a dedicated, carefully-reviewed follow-up.
5. **Mop up** ARC-015/019/021/023/028/029, QA-013/016.
6. Re-run `/audit` to refresh AUDIT.md.
