# Edge data volume

The edge keeps its ACME account and certificate keys under `/data` (Caddy's `XDG_DATA_HOME`) and its autosaved config
under `/config`. The edge image gives both trees to the caddy user (65532) at mode 0700 (`deployment/edge/Dockerfile`,
P1.27o). Docker copies the image's files into a volume only when the volume is empty, and hides them behind a
volume that already holds data ([Docker volumes: mounting a volume over existing
data](https://docs.docker.com/engine/storage/volumes/#mounting-a-volume-over-existing-data), read 2026-10-12). That
page does not say the directory's owner and mode come along; the edge test `edge_data_volume_is_caddys_alone` shows
they do on Docker 29.8.2. A volume created from an older edge image keeps the old root-owned layout.

**Who:** whoever runs the stack.

## Steps

1. Find the volume mounted at the edge's `/data` with
   `docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' <edge container>`
   (`docker volume ls` lists volumes but not where they are mounted).
2. Remove the edge container, not just stop it (`docker rm -f <edge container>`, or `docker compose rm -sf edge`):
   `docker volume rm` refuses a volume that any container, stopped ones included, still uses.
3. Remove the volume with `docker volume rm <volume>`.
4. Start the edge again. Docker seeds a fresh volume from the image, and Caddy issues new certificates on start.

Each re-issue counts against Let's Encrypt's rate limits, so do this once per volume, not on every deploy.
