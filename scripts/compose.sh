#!/bin/sh
set -eu

# Support both Docker Compose v2 ("docker compose") and legacy v1 ("docker-compose").
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi

if command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose "$@"
fi

echo "Docker Compose is not available." >&2
echo "Install and start Docker Desktop, then retry." >&2
echo "Check with: docker compose version || docker-compose --version" >&2
exit 1
