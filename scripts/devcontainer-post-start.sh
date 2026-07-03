#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure persistent named volumes are writable by the dev user.
bash "${SCRIPT_DIR}/ensure-devcontainer-volumes.sh"

# Mark the mounted workspace as safe for Git.
# Avoid adding duplicate entries on every container start.
if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "/workspace/annot"; then
  git config --global --add safe.directory /workspace/annot
fi

echo "Dev container post-start setup completed."
