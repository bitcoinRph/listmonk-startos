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
| MCP runtime | `@kieksme/listmonk-mcp` 1.3.0 behind a package-owned hardened HTTP entrypoint |
| Architectures | x86_64, aarch64 |
| Start sequence | PostgreSQL, Listmonk install/upgrade oneshot, MCP API-user provisioning oneshot, Listmonk, then the MCP server. Listmonk uses `--config ""` so file-based config comes only from `LISTMONK_*` env vars. |

## Volume and Data Layout

| Volume | Mounted at | Contents |
| --- | --- | --- |
| `main` | `/listmonk/uploads` (subpath `uploads`) | Uploaded media |
| `main` | not mounted in any container (root) | `store.json`: generated internal Postgres password |
| `db` | `/var/lib/postgresql` | PostgreSQL cluster (`PGDATA=/var/lib/postgresql/data`) |
| `mcp` | `/startos-mcp` in the MCP sidecar | Internal Listmonk API token and client-facing MCP bearer token; repaired through a writable root-only lifecycle mount, then mounted read-only for the non-root MCP daemon |

Both credential stores sit outside the uploads subpath, so neither is served over HTTP.

## Network Access and Interfaces

| Interface | Port | Type | Serves |
| --- | --- | --- | --- |
| Web UI (`ui` on host `main`) | 9000 | ui | Admin dashboard at `/admin`, public subscription forms, opt-in, unsubscribe, and archive pages |
| REST API (`api` on host `main`) | 9000 | api | Listmonk's authenticated `/api` endpoints |
| MCP (`mcp` on host `mcp`) | 3000 | api | Streamable HTTP endpoint at `/mcp`; requires an HTTP `Authorization` header using bearer authentication |

PostgreSQL listens on `127.0.0.1:5432` only and is not exposed.

## Installation and First-Run Flow

1. On install, init generates the internal Postgres password, a dedicated Listmonk API token for the MCP sidecar, and a separate bearer token for MCP clients.
2. On first start, Postgres initializes the `listmonk` database, then `listmonk --install --idempotent` creates the schema without an administrator account.
3. Before Listmonk starts serving requests, an idempotent provisioning step creates or repairs the `StartOS MCP` role and `startos-mcp` API user. Its token is stored as a SHA-256 hash in Listmonk's database, matching Listmonk 6.2's native API-user behavior.
4. Listmonk starts and loads the dedicated API user into its in-memory authentication cache, then the MCP sidecar starts.
5. On the first Web UI visit, Listmonk’s own setup page asks the operator to create the super-admin account. The password never passes through StartOS package state or action logs.

Root URL and SMTP are set by the user in the Listmonk UI (stored in the database), not by the package.

## Actions

- **Rotate MCP Bearer** generates a new Hermes-facing bearer, retains the prior bearer for rollback, rejects duplicate pending rotations, and never displays either value.
- **Rollback MCP Bearer** restores the retained bearer and clears the failed rotation without displaying either value.
- **Finalize MCP Bearer Rotation** removes the retained rollback bearer after the new bearer is verified.
- **Export Encrypted MCP Bearer** returns only RSA-OAEP ciphertext encrypted to a one-time public key generated inside Hermes.

Account creation and password management stay inside Listmonk. Follow the credential runbook before using any bearer action.

## MCP Authentication

The MCP endpoint is not open. It requires the bearer generated into the private `mcp` volume. The plaintext token is never returned through a StartOS action because action responses can be written to package logs. The encrypted handoff action returns only ciphertext that can be decrypted by the one-time private key kept inside Hermes. Configure an agent through the protected transfer runbook and use the standard HTTP bearer scheme.

The MCP sidecar uses a separate Listmonk API user named `startos-mcp`; it does not use or know the human administrator password. Its package-owned role permits subscriber reads, campaign drafting and reporting, list/template/media management, and bounce reads. It does not grant campaign-wide bypass permissions, settings access, campaign sending, subscriber mutation/import, or bounce-management permissions.

The package registers exactly 32 named tools from one canonical policy file. It does not enable broad categories. Campaign update, send, campaign-status, test-send, opt-in-send, delete, blocklist, import, subscriber-create/update, membership-mutation, default-template, settings/log retrieval, settings mutation, user administration, maintenance, transactional email, and application reload tools are absent. The campaign-create wrapper removes and rejects `send_later` and `send_at`, so creation can only produce a draft. Requests carrying `X-Listmonk-Enabled-Tools` or a `tools` query parameter are rejected instead of expanding the tool set.

Treat the bearer as sensitive and keep the MCP interface internal. Follow [`docs/hermes-listmonk-credential-runbook.md`](docs/hermes-listmonk-credential-runbook.md) for transfer, runtime-user preflight, restart, rollback, and rotation.

## Health Checks

| Check | Method |
| --- | --- |
| Database | `pg_isready` on 127.0.0.1 |
| Web Interface | HTTP fetch of `http://127.0.0.1:9000/admin` (30 s grace period) |
| MCP | HTTP fetch of `http://127.0.0.1:3000/healthz` |

## Backups and Restore

`sdk.Backups.withPgDump` on the `db` volume (logical dump, consistent while running) plus the full `main` and `mcp` volumes. A restore preserves the Listmonk administrator account, dedicated API user, and MCP credentials.

Package downgrades are declared impossible. Before a sideload, keep a pre-update PostgreSQL custom-format dump and validate it with `pg_restore -l <dump-file>`. The recovery path is reinstalling the prior package revision and restoring the validated dump plus the `main` and `mcp` volumes. Template rollback artifacts must preserve the complete template record (`id`, `name`, `type`, `subject`, `body`, and default status), not only the HTML body.

Use timestamped, no-clobber rollback filenames and verify owner and mode after creation. Do not overwrite a prior recovery point.

## Limitations and Differences

- StartOS cannot retrieve or reset the Listmonk admin password; configure Listmonk email-based password recovery and keep the password in a password manager.
- The MCP bearer token is deliberately not exposed in plaintext through an action. Agent configuration requires the encrypted local procedure in [`docs/hermes-listmonk-credential-runbook.md`](docs/hermes-listmonk-credential-runbook.md).
- The bundled Owner's Brief template uses the existing Freehold website PNG endpoint rather than a packaged dead asset. Treat that remote endpoint as an availability dependency and recheck it during template QA.
- No SMTP wiring to StartOS system SMTP; configure SMTP in listmonk settings.
- English-only package strings.

## Building

```
npm ci
npm run check
make            # x86_64 and aarch64 .s9pk
```

CI: `.github/workflows/build.yml` builds on pull requests using Start9's shared workflow.
