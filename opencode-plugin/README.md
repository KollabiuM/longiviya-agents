# OpenCode Plugin for Claude Office Visualizer

An [OpenCode](https://opencode.ai) plugin that sends lifecycle events to the Claude Office Visualizer backend, enabling the same pixel-art office visualization that the Claude Code hooks provide.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Known Limitations](#known-limitations)
- [Event Mapping](#event-mapping)
- [Commands](#commands)
- [Development](#development)
- [Uninstallation](#uninstallation)
- [Related Documentation](#related-documentation)

## Overview

The plugin intercepts OpenCode lifecycle events (session, tool, message, permission, compaction, token usage) and POSTs them to the claude-office backend API. Events are fire-and-forget with short timeouts so the plugin never blocks OpenCode.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| OpenCode | Latest |
| Bun | 1.0+ |
| Claude Office backend | Running on `localhost:8000` |

## Installation

```bash
# From the project root
make opencode-install
```

This builds the plugin, links it globally via bun, and registers it in `~/.config/opencode/opencode.json`.

## Configuration

Configuration is via environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_OFFICE_API_URL` | `http://localhost:8000/api/v1/events` | Backend API endpoint. Non-localhost values are reset to the default unless `CLAUDE_OFFICE_ALLOW_REMOTE=1` |
| `CLAUDE_OFFICE_ALLOW_REMOTE` | `0` | Set to `1` to permit a non-localhost backend (opt-in; payloads carry tool I/O and file paths) |
| `CLAUDE_OFFICE_TIMEOUT_MS` | `1500` | HTTP request timeout in milliseconds |
| `CLAUDE_OFFICE_DEBUG` | `0` | Set to `1` to log events to stderr |
| `CLAUDE_OFFICE_API_KEY` | _(unset)_ | API key sent as `X-API-Key`. Required when the backend is started with an explicit `CLAUDE_OFFICE_API_KEY`; leave unset otherwise. |

## Known Limitations

- **API-key support.** When `CLAUDE_OFFICE_API_KEY` is set, the plugin sends it as the `X-API-Key` header on every event POST, so deployments that configure an explicit backend key no longer lose events to silent 401s. When unset, the plugin sends no such header and behavior is unchanged (the backend's default auto-generated-key mode leaves `POST /api/v1/events` open). The plugin deliberately never surfaces transport errors — enable `CLAUDE_OFFICE_DEBUG=1` to diagnose lingering 401s.

## Event Mapping

The plugin maps OpenCode events to claude-office backend events:

| OpenCode Event | Backend Event |
|----------------|---------------|
| `session.created` | `session_start` |
| `session.deleted` | `session_end` |
| `session.idle` | `stop` |
| `session.compacted` | `context_compaction` |
| `chat.message` hook | `user_prompt_submit` |
| `tool.execute.before` | `pre_tool_use` / `subagent_start` |
| `tool.execute.after` | `post_tool_use` / `subagent_stop` |
| `permission.ask` | `permission_request` |
| `step-finish` part | `reporting` (token usage) |
| `message.updated` (assistant) | `reporting` (token usage) |

Tool names matching `task` or `agent` (case-insensitive) are mapped as subagent events, matching the Claude Code behavior.

## Commands

| Command | Description |
|---------|-------------|
| `make opencode-install` | Build and register plugin with OpenCode |
| `make opencode-uninstall` | Remove plugin from OpenCode |
| `make opencode-reinstall` | Uninstall and reinstall plugin |
| `make opencode-build` | Build plugin without registering |

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Type check
bun run typecheck
```

## Uninstallation

```bash
make opencode-uninstall
```

## Related Documentation

- [Project README](../README.md) - Project overview
- [Architecture](../docs/architecture/ARCHITECTURE.md) - System design details
- [Quick Start](../docs/guides/quickstart.md) - Getting started guide
