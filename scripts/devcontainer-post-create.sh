#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/ensure-devcontainer-volumes.sh"

pnpm install --frozen-lockfile

# Chromium for the Playwright suites (docs-site tour, annot-playwright,
# annot-mcp browser tools); --with-deps installs the required system
# libraries (re-run after a container rebuild, binaries persist in the
# ms-playwright named volume).
pnpm --filter @ingcreators/annot-docs-site exec playwright install --with-deps chromium

bash "${SCRIPT_DIR}/verify-dev-env.sh"
