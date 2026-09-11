#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

usage() {
  cat <<'HELP'
Usage: ./scripts/local.sh [up|start|down|logs|status|check|help]

  up      Build this checkout, start all services, and check readiness (default).
  start   Start existing images and check readiness, without rebuilding.
  down    Stop and remove the containers, keeping local database volumes.
  logs    Follow the Dittofeed application logs (Ctrl+C exits log following).
  status  Show the local containers and their health.
  check   Verify bootstrap, authenticated API access, and Temporal workflows.

Requires Docker with Compose and a running Docker engine.
HELP
}

action="${1:-up}"
if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi
case "$action" in
  help|-h|--help) usage; exit 0 ;;
  up|start|down|logs|status|check) ;;
  *) usage >&2; exit 2 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is missing. Install Docker with the Compose plugin, then retry." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is unavailable. Enable or install Docker Compose first." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Cannot reach Docker. Start Docker Desktop (or the Docker engine) and retry." >&2
  exit 1
fi

# Use only this stack's configuration, even when launched outside the repository.
compose=(docker compose --env-file /dev/null --project-name dittofeed-local -f "$repo_dir/docker-compose.local.yaml")

diagnostics() {
  "${compose[@]}" ps --all >&2 || true
  "${compose[@]}" logs --tail 50 lite temporal >&2 || true
}

check_ready() {
  echo "Checking Dittofeed bootstrap and local services..."
  if ! "${compose[@]}" exec -T lite node - < "$repo_dir/scripts/local-check.cjs"; then
    diagnostics
    return 1
  fi
}

show_urls() {
  cat <<'URLS'

Dittofeed is ready:
  Dashboard:    http://localhost:3000/dashboard
  Password:     local-dittofeed
  Temporal UI:  http://localhost:8080

Containers run in the background. Stop them with ./scripts/local.sh down.
URLS
}

case "$action" in
  up|start)
    if [[ "$action" == up ]]; then
      export DITTOFEED_APP_VERSION
      DITTOFEED_APP_VERSION="$(git rev-parse HEAD 2>/dev/null || printf '%s' local-checkout)"
      echo "Building Dittofeed from $repo_dir ($DITTOFEED_APP_VERSION)..."
      "${compose[@]}" build lite
    fi
    if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 180; then
      diagnostics
      exit 1
    fi
    check_ready
    show_urls
    ;;
  down)
    "${compose[@]}" down
    echo "Dittofeed stopped. Local database volumes are preserved."
    ;;
  logs) "${compose[@]}" logs --follow --tail 100 lite ;;
  status) "${compose[@]}" ps --all ;;
  check) check_ready; show_urls ;;
esac
