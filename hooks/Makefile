.PHONY: install test lint fmt typecheck checkall

install:
	uv sync

test:
	uv run pytest

lint:
	uv run ruff check .

fmt:
	uv run ruff format .

typecheck:
	uv run pyright

checkall: fmt lint typecheck test
