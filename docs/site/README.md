# Docs site

Hugo site for the unset documentation. The theme is Hextra v0.13.0, required from `go.mod` as a Hugo module. `public/` and `resources/` are build output and are git-ignored. There is no `package.json` here.

From the repository root:

```sh
docker run --rm --entrypoint hugo -v "$PWD:/project" -w /project/docs/site ghcr.io/gohugoio/hugo:v0.168.0@sha256:1fb8fe7f417abd5802d86747d297728aa48078d763159e7dff6559fe3f8bb8e7 build --gc --minify --panicOnWarning
```

The image is Hugo extended v0.168.0. Its entrypoint runs `npm i` when it finds a `package.json` (`scripts/docker/entrypoint.sh` in gohugoio/hugo v0.168.0). `--entrypoint hugo` skips that step.
