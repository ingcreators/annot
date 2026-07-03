#!/usr/bin/env bash
set -euo pipefail

echo "== Node =="
node --version

echo "== pnpm =="
pnpm --version

echo "== Git =="
git --version

echo "== GitHub CLI =="
gh --version | head -n 1

echo "== Claude Code =="
claude --version || echo "claude CLI not on PATH yet (feature install pending?)"

echo "== Playwright Chromium =="
ls "${HOME}/.cache/ms-playwright" 2>/dev/null | grep -i chromium \
  || echo "Chromium not installed yet — run: pnpm --filter @ingcreators/annot-docs-site exec playwright install --with-deps chromium"

echo "Development environment looks ready."
