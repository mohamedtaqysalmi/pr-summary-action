.PHONY: dev test lint build

dev:
	npm ci
	npm run build
	node dist/cli.js dry-run --diff-file tests/fixtures/sample.diff --commits-file tests/fixtures/commits.json --language en --mode full

test:
	npm ci
	npm test
	npm run build
	npm run test:cli

lint:
	npm ci
	npm run lint
	npm run format:check
	npm run typecheck

build:
	npm ci
	npm run build
