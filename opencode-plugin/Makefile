.PHONY: install test lint fmt typecheck checkall

PKG_MGR := $(shell command -v bun >/dev/null 2>&1 && echo "bun" || echo "npm")

install:
	$(PKG_MGR) install

test:
	@if find src tests -name '*.test.ts' 2>/dev/null | grep -q .; then $(PKG_MGR) test; else echo "opencode-plugin: no tests yet (see QA-002)"; fi

lint:
	$(PKG_MGR) run lint

fmt:
	@echo "opencode-plugin: no formatter configured"

typecheck:
	$(PKG_MGR) run typecheck

checkall: lint typecheck test
