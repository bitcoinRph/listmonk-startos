# AGENTS.md

This is a StartOS service-package repository. It builds a `.s9pk` for StartOS.

Develop it inside a StartOS packaging workspace created by `start-cli s9pk init-workspace`. The packaging guide is at <https://docs.start9.com/packaging>.

Keep `README.md` (technical reference) and `instructions.md` (end-user docs) in sync with your changes.

## This repo

- **This is a fork of upstream listmonk, repurposed.** The `startos-package` branch holds only the wrapper; the Go/Vue source was removed from that branch. `master` still tracks upstream source. The package runs the published upstream image and never builds listmonk from source.
- **Config comes only from env vars.** Every listmonk invocation uses `--config ""`, so `LISTMONK_*` env vars in `startos/main.ts` are the whole file-based config. Settings a user changes in the UI (root URL, SMTP, etc.) live in the database, not in the package.
- **The admin password is applied once.** `LISTMONK_ADMIN_*` only takes effect when `--install --idempotent` runs on an empty database. After that listmonk owns the hash; `store.json.adminPassword` is the original value only.
- **`store.json` must stay outside the `uploads` subpath.** The uploads directory is served over HTTP.
