<p align="center">
  <img src="icon.svg" alt="listmonk logo" width="21%">
</p>

# listmonk on StartOS

> Everything not listed in this document should behave the same as upstream
> listmonk. If a feature, setting, or behavior is not mentioned here, the
> upstream documentation is accurate and fully applicable.

[listmonk](https://github.com/knadh/listmonk) is a self-hosted newsletter and mailing list manager. This package runs the upstream image with a bundled PostgreSQL database, labels Listmonk's REST API as a StartOS interface, and adds a bearer-protected Streamable HTTP MCP server. The administrator creates the account through Listmonk’s own first-run page.

- **Upstream repo:** <https://github.com/knadh/listmonk>
- **Wrapper repo:** <https://github.com/bitcoinRph/listmonk-startos>

This repository is a fork of upstream listmonk, repurposed as a StartOS wrapper on the `startos-package` branch. The upstream source is not rebuilt; the package pulls the published image.

## Image and Container Runtime

| Property | Value |
| --- | --- |
| listmonk image | `listmonk/listmonk:v6.2.0` (upstream, unmodified) |
| Database image | `postgres:17-alpine` (upstream, unmodified) |
| MCP runtime | `@kieksme/listmonk-mcp` 1.3.0 in a package-built Node.js sidecar |
| Architectures | x86_64, aarch64 |
| Start sequence | PostgreSQL, Listmonk install/upgrade oneshot, MCP API-user provisioning oneshot, Listmonk, then the MCP server. Listmonk uses `--config ""` so file-based config comes only from `LISTMONK_*` env vars. |

## Volume and Data Layout

| Volume | Mounted at | Contents |
| --- | --- | --- |
| `main` | `/listmonk/uploads` (subpath `uploads`) | Uploaded media |
| `main` | not mounted in any container (root) | `store.json`: generated internal Postgres password |
| `db` | `/var/lib/postgresql` | PostgreSQL cluster (`PGDATA=/var/lib/postgresql/data`) |
| `mcp` | `/startos-mcp` in the MCP sidecar, read-only | Internal Listmonk API token and client-facing MCP bearer token |

Both credential stores sit outside the uploads subpath, so neither is served over HTTP.

## Network Access and Interfaces

| Interface | Port | Type | Serves |
| --- | --- | --- | --- |
| Web UI (`ui` on host `main`) | 9000 | ui | Admin dashboard at `/admin`, public subscription forms, opt-in, unsubscribe, and archive pages |
| REST API (`api` on host `main`) | 9000 | api | Listmonk's authenticated `/api` endpoints |
| MCP (`mcp` on host `mcp`) | 3000 | api | Streamable HTTP endpoint at `/mcp`; requires an `Authorization: Bearer` header |

PostgreSQL listens on `127.0.0.1:5432` only and is not exposed.

## Installation and First-Run Flow

1. On install, init generates the internal Postgres password, a dedicated Listmonk API token for the MCP sidecar, and a separate bearer token for MCP clients.
2. On first start, Postgres initializes the `listmonk` database, then `listmonk --install --idempotent` creates the schema without an administrator account.
3. Before Listmonk starts serving requests, an idempotent provisioning step creates or repairs the `StartOS MCP` role and `startos-mcp` API user. Its token is stored as a SHA-256 hash in Listmonk's database, matching Listmonk 6.2's native API-user behavior.
4. Listmonk starts and loads the dedicated API user into its in-memory authentication cache, then the MCP sidecar starts.
5. On the first Web UI visit, Listmonk’s own setup page asks the operator to create the super-admin account. The password never passes through StartOS package state or action logs.

Root URL and SMTP are set by the user in the Listmonk UI (stored in the database), not by the package.

## Actions

None. Account creation and password management stay inside Listmonk.

## MCP Authentication

The MCP endpoint is not open. It requires the bearer token generated into the private `mcp` volume. That token is intentionally not returned through a StartOS action because action responses can be written to package logs. Configure an agent through a secure local management path and send the token only as an `Authorization: Bearer` header.

The MCP sidecar uses a separate Listmonk API user named `startos-mcp`; it does not use or know the human administrator password. Its package-owned role permits lists, subscribers, imports, campaigns, bounces, media, templates, reporting, and read-only settings access. The MCP server omits user administration, settings changes, maintenance deletion, transactional email, and application-reload tools. Campaign tools can still send mail, so treat MCP access as sensitive and do not publish its interface without an additional access-control review.

## Health Checks

| Check | Method |
| --- | --- |
| Database | `pg_isready` on 127.0.0.1 |
| Web Interface | HTTP fetch of `http://127.0.0.1:9000/admin` (30 s grace period) |
| MCP | HTTP fetch of `http://127.0.0.1:3000/healthz` |

## Backups and Restore

`sdk.Backups.withPgDump` on the `db` volume (logical dump, consistent while running) plus the full `main` and `mcp` volumes. A restore preserves the Listmonk administrator account, dedicated API user, and MCP credentials.

## Limitations and Differences

- StartOS cannot retrieve or reset the Listmonk admin password; configure Listmonk email-based password recovery and keep the password in a password manager.
- The MCP bearer token is deliberately not exposed through an action. Agent configuration requires a secure local credential-transfer step.
- No SMTP wiring to StartOS system SMTP; configure SMTP in listmonk settings.
- English-only package strings.

## Building

```
npm ci
npm run check
make            # x86_64 and aarch64 .s9pk
```

CI: `.github/workflows/build.yml` builds on pull requests using Start9's shared workflow.
