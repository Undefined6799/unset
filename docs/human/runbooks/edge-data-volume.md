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

1. Stop the edge, find the volume mounted at its `/data` (`docker volume ls`), and remove it with `docker volume rm`.
2. Start the edge again. Docker seeds a fresh volume from the image, and Caddy issues new certificates on start.

Each re-issue counts against Let's Encrypt's rate limits, so do this once per volume, not on every deploy.
