# Updating listmonk-startos

## What "upstream" means here

- **listmonk:** the published image `listmonk/listmonk` on Docker Hub, built from <https://github.com/knadh/listmonk> releases.
- **PostgreSQL:** the `postgres:17-alpine` image. Stay on major version 17: a major Postgres bump needs a dump and restore, not a tag change.

## Where the pins live

- `startos/manifest/index.ts`: `images.listmonk.source.dockerTag` and `images.postgres.source.dockerTag`.
- `startos/versions/current.ts`: the package version (`<listmonk version>:<wrapper revision>`).

## Bumping listmonk

1. Read the upstream release notes for breaking config or env changes, and check whether `docker-compose.yml` upstream changed its start command.
2. Set the new `dockerTag` (use the `vX.Y.Z` tag, never `latest`).
3. Move the old `current` into its own file under `startos/versions/`, add it to `other` in `startos/versions/index.ts`, and write a new `current` with the new version and release notes. Database migrations run on start via `listmonk --upgrade`; the package needs no migration code unless the StartOS side changes.
4. `npm run check`, `make`, install on a test server, confirm the dashboard loads and a test campaign sends.
