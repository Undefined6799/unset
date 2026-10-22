#!/usr/bin/env bash
# P2.24d spike only: an isolated official PDS (internal network, no egress) behind pinned Caddy 2.11.7.
set -euo pipefail
PDS_IMAGE="ghcr.io/bluesky-social/pds:0.4.5037@sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4"
EDGE_IMAGE="docker.io/library/caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${RUNNER_TEMP:?}/p224d"
mkdir -p "$OUT/pds"
chmod 0777 "$OUT/pds"
docker network create --internal p224d-internal
docker network create p224d-public
docker run -d --name pds --network p224d-internal --network-alias pds \
  -e PDS_HOSTNAME=pds.test -e PDS_PORT=3000 \
  -e PDS_DATA_DIRECTORY=/pds -e PDS_BLOBSTORE_DISK_LOCATION=/pds/blocks \
  -e PDS_JWT_SECRET="$(openssl rand -hex 32)" -e PDS_ADMIN_PASSWORD="$(openssl rand -hex 24)" \
  -e PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX="$(openssl rand -hex 32)" \
  -e PDS_DID_PLC_URL=http://plc.invalid -e PDS_INVITE_REQUIRED=true -e PDS_CRAWLERS= \
  -e LOG_ENABLED=false \
  -v "$OUT/pds:/pds" "$PDS_IMAGE"
docker run -d --name edge --network p224d-public -p 127.0.0.1:443:443 \
  -v "$ROOT/spike/p224d/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$ROOT/shared/ui/fonts:/srv/fonts:ro" "$EDGE_IMAGE"
docker network connect p224d-internal edge
for _ in $(seq 1 60); do
  if docker exec edge wget -q -O /dev/null http://pds:3000/xrpc/_health; then break; fi
  sleep 2
done
docker exec edge wget -q -O /dev/null http://pds:3000/xrpc/_health
# The PDS cannot reach the internet: its network is internal.
if docker exec pds node -e 'fetch("https://plc.directory").then(()=>process.exit(0),()=>process.exit(1))'; then
  echo "PDS reached the internet" >&2
  exit 1
fi
echo "127.0.0.1 pds.test" | sudo tee -a /etc/hosts
# The upstream policy as the PDS sends it, straight from the internal network, for the comparison test.
for path in /account "/oauth/authorize?client_id=x"; do
  name="$(echo "$path" | tr -c 'a-z' '_')"
  docker exec edge wget -S -O /dev/null --header "Host: pds.test" --header "X-Forwarded-Proto: https" \
    "http://pds:3000$path" 2> "$OUT/upstream-$name.txt" || true
done
ls -l "$OUT"
