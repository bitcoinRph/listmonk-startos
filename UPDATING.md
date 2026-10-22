# Updating listmonk-startos

## What "upstream" means here

- **listmonk:** the published image `listmonk/listmonk` on Docker Hub, built from <https://github.com/knadh/listmonk> releases.
- **PostgreSQL:** the `postgres:17-alpine` image. Stay on major version 17: a major Postgres bump needs a dump and restore, not a tag change.

## Where the pins live

- `startos/manifest/index.ts`: `images.listmonk.source.dockerTag` and `images.postgres.source.dockerTag`.
- `startos/versions/current.ts`: the package version (`<listmonk version>:<wrapper revision>`).

## Bumping listmonk

1. Select the highest published stable `vX.Y.Z` release by numeric version, excluding drafts and prerelease tag suffixes even if GitHub marks them `prerelease=false` (for example, `v7.0.0-beta.1` is not stable). Read the upstream release notes for breaking config or env changes, and check whether `docker-compose.yml` upstream changed its start command.
2. Set the new `dockerTag` (use the `vX.Y.Z` tag, never `latest`).
3. Follow the [official version-file rule](https://docs.start9.com/packaging/0.4.0.x/versions.html#when-to-create-a-new-version-file): inspect the outgoing `current` migration. If its `up` body is empty, bump `current.ts` in place and leave `other` unchanged (`down: IMPOSSIBLE` is not a migration). Only if the outgoing version carries a nonempty migration, preserve it permanently in `v<upstream>_<revision>.ts`, rename its export, and add it to `other` before writing a fresh `current.ts`. Never carry the old migration into its successor. Database migrations run on start via `listmonk --upgrade`; the package needs no migration code unless the StartOS side changes.
4. `npm ci`, `npm ci --prefix mcp --omit=dev --ignore-scripts`, `npm run check`, `npm test`, `make`. On a disposable test database, verify fresh setup and MCP authorization: `/api/lists` must work, while `/api/users` and `/api/settings` must return 403 for the dedicated MCP account. Verify repair of an older MCP role ID 1 without changing human accounts. Install on a test server only with approval, confirm the dashboard loads and a test campaign sends.
