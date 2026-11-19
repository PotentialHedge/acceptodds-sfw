#!/usr/bin/env bash
# Swap production's app containers for the image of HEAD with no gap in service.
#
# Starts `deploy.replicas` new containers beside the running ones, waits until
# Docker calls them healthy and Traefik routes to them, then stops and removes
# the old ones. Plain `up -d app` would recreate them all at once, leaving
# Traefik no healthy server until the new ones pass their check.
#
# Builds the images and runs migrations first, as the deploy steps in
# docker-compose.prod.yml do. SKIP_BUILD=1 swaps to an image already built for
# HEAD (or for $GIT_COMMIT, set by hand, to roll back).
set -euo pipefail
cd "$(dirname "$0")/.."

compose() { docker compose -f docker-compose.prod.yml --env-file .env.production "$@"; }
TRAEFIK_SERVICE=http://127.0.0.1:8080/api/http/services/acceptodds-sfw@docker
REPLICAS=2

if [[ -z "${GIT_COMMIT:-}" ]]; then
  test -z "$(git status --porcelain)" || { echo "commit first: the image is tagged with HEAD" >&2; exit 1; }
  GIT_COMMIT=$(git rev-parse --short HEAD)
fi
export GIT_COMMIT

if [[ -z "${SKIP_BUILD:-}" ]]; then
  compose --profile tools build
  compose up -d postgres
  compose run --rm tools
fi

old=$(compose ps -q app)
echo "old containers: $(echo $old | wc -w)"

compose up -d --no-deps --no-recreate --scale app=$(( $(echo $old | wc -w) + REPLICAS )) app
new=$(comm -13 <(echo "$old" | sort) <(compose ps -q app | sort))
echo "new containers: $(echo $new | wc -w)"

ips=()
for id in $new; do
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$id")
    [[ $status == healthy ]] && break
    [[ $status == unhealthy ]] && { echo "$id is unhealthy; old containers left running" >&2; exit 1; }
    sleep 2
  done
  [[ $status == healthy ]] || { echo "$id not healthy after 120s; old containers left running" >&2; exit 1; }
  ips+=("$(docker inspect -f '{{(index .NetworkSettings.Networks "web").IPAddress}}' "$id")")
done

for _ in $(seq 1 30); do
  up=$(curl -s "$TRAEFIK_SERVICE" | python3 -c '
import json, sys
status = json.load(sys.stdin).get("serverStatus", {})
print(" ".join(u for u, s in status.items() if s == "UP"))')
  missing=0
  for ip in "${ips[@]}"; do [[ " $up " == *"http://$ip:3000 "* ]] || missing=1; done
  [[ $missing == 0 ]] && break
  sleep 1
done
[[ $missing == 0 ]] || { echo "Traefik does not route to all new containers; old containers left running" >&2; exit 1; }

if [[ -n "$old" ]]; then
  docker stop $old >/dev/null
  docker rm $old >/dev/null
fi
echo "live: $(compose ps --format '{{.Name}} {{.Image}} {{.Status}}' app)"
