<p align="center">
  <img src="icon.svg" alt="listmonk logo" width="21%">
</p>

# listmonk on StartOS

> Everything not listed in this document should behave the same as upstream
> listmonk. If a feature, setting, or behavior is not mentioned here, the
> upstream documentation is accurate and fully applicable.

[listmonk](https://github.com/knadh/listmonk) is a self-hosted newsletter and mailing list manager. This package runs the upstream image with a bundled PostgreSQL database. The administrator creates the account through Listmonk’s own first-run page.

- **Upstream repo:** <https://github.com/knadh/listmonk>
- **Wrapper repo:** <https://github.com/bitcoinRph/listmonk-startos>

This repository is a fork of upstream listmonk, repurposed as a StartOS wrapper on the `startos-package` branch. The upstream source is not rebuilt; the package pulls the published image.

## Image and Container Runtime

| Property | Value |
| --- | --- |
| listmonk image | `listmonk/listmonk:v6.2.0` (upstream, unmodified) |
| Database image | `postgres:17-alpine` (upstream, unmodified) |
| Architectures | x86_64, aarch64 |
| Start command | Upstream entrypoint, then `listmonk --install --idempotent`, `listmonk --upgrade`, `listmonk`, all with `--config ""` so config comes only from `LISTMONK_*` env vars. Same sequence as upstream `docker-compose.yml`. |

## Volume and Data Layout

| Volume | Mounted at | Contents |
| --- | --- | --- |
| `main` | `/listmonk/uploads` (subpath `uploads`) | Uploaded media |
| `main` | not mounted in any container (root) | `store.json`: generated internal Postgres password |
| `db` | `/var/lib/postgresql` | PostgreSQL cluster (`PGDATA=/var/lib/postgresql/data`) |

`store.json` sits outside the uploads subpath, so it is never served over HTTP.

## Network Access and Interfaces

| Interface | Port | Type | Serves |
| --- | --- | --- | --- |
| Web UI (`ui` on host `main`) | 9000 | ui | Admin dashboard at `/admin`, public subscription forms, opt-in, unsubscribe, and archive pages |

PostgreSQL listens on `127.0.0.1:5432` only and is not exposed.

## Installation and First-Run Flow

1. On install, init generates a 32-character internal Postgres password into `store.json`.
2. On first start, Postgres initializes the `listmonk` database, then `listmonk --install --idempotent` creates the schema without an administrator account.
3. On the first visit, Listmonk’s own setup page asks the operator to create the super-admin account. The password never passes through StartOS package state or action logs.
4. On later starts, `--install --idempotent` is a no-op and `--upgrade` applies any migrations after an image update.

Root URL and SMTP are set by the user in the Listmonk UI (stored in the database), not by the package.

## Actions

None. Account creation and password management stay inside Listmonk.

## Health Checks

| Check | Method |
| --- | --- |
| Database | `pg_isready` on 127.0.0.1 |
| Web Interface | HTTP fetch of `http://127.0.0.1:9000/admin` (30 s grace period) |

## Backups and Restore

`sdk.Backups.withPgDump` on the `db` volume (logical dump, consistent while running) plus the full `main` volume. A restore preserves the Listmonk administrator account and password because they live in the restored database.

## Limitations and Differences

- StartOS cannot retrieve or reset the Listmonk admin password; configure Listmonk email-based password recovery and keep the password in a password manager.
- No SMTP wiring to StartOS system SMTP; configure SMTP in listmonk settings.
- English-only package strings.

## Building

```
npm ci
npm run check
make            # x86_64 and aarch64 .s9pk
```

CI: `.github/workflows/build.yml` builds on pull requests using Start9's shared workflow.
