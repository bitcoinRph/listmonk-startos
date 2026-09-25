# Hermes and Listmonk MCP credential runbook

Use this procedure to connect Hermes to Listmonk or rotate the Hermes-facing MCP bearer. Never print, echo, trace, return, screenshot, or place a credential in a shell argument.

## Credential boundaries

Keep these separate:

- the human Listmonk administrator credential
- the package-owned `startos-mcp` Listmonk API token
- the Hermes-facing MCP bearer

The StartOS rotation actions never return either package credential. StartOS action responses can be logged, so that boundary is deliberate.

Do not restart Hermes from the active gateway turn doing this work. Stage and verify the files, record the checkpoint, then restart from a separate management path.

## Protected rollback copies

Create timestamped, no-clobber backups. Do not overwrite an earlier recovery point.

```sh
set -eu
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
env_backup="/opt/data/.env.pre-listmonk.${stamp}"
config_backup="/opt/data/config.yaml.pre-listmonk.${stamp}"

test ! -e "$env_backup"
test ! -e "$config_backup"
install -o hermes -g hermes -m 600 /opt/data/.env "$env_backup"
install -o hermes -g hermes -m 600 /opt/data/config.yaml "$config_backup"
stat -c '%a %U %G %n' "$env_backup" "$config_backup"
```

Expected result: both backups are owned by `hermes:hermes` and mode `0600`. Record the two timestamped paths in the maintenance note without copying their contents.

## Initial transfer or rotation

For a rotation, run the package's secret-safe action:

```sh
printf '{}\n' | start-cli package action run listmonk rotate-mcp-bearer
```

The action stores a new bearer, retains the prior bearer for rollback, and returns only a non-secret status message. It rejects a second rotation while one is pending. The running MCP daemon continues using the prior bearer until Listmonk is restarted.

For an initial transfer, skip the rotate action and export the package's current bearer. For either case, use the package's encrypted handoff action:

1. Generate a one-time RSA key inside the Hermes package. Only the public key leaves Hermes:

   ```sh
   set -eu
   start-cli package attach hermes-agent -u hermes sh -lc '
     set -eu
     umask 077
     key=/opt/data/cache/listmonk-handoff-private.pem
     pub=/opt/data/cache/listmonk-handoff-public.pem
     test ! -e "$key"
     test ! -e "$pub"
     openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$key" >/dev/null 2>&1
     openssl pkey -in "$key" -pubout -out "$pub"
     openssl pkey -in "$key" -pubout
   '
   ```

2. In the Listmonk StartOS actions, run **Export Encrypted MCP Bearer**. Paste the printed PEM public key. The action returns base64 RSA-OAEP ciphertext, never plaintext. Do not place the ciphertext in chat.
3. Put that non-secret ciphertext in the local shell variable `ciphertext`, then decrypt and atomically update Hermes's protected environment file:

   ```sh
   set -eu
   test -n "${ciphertext:?set ciphertext to the action result}"
   start-cli package attach hermes-agent -u root sh -lc '
     set -eu
     umask 077
     cipher=$1
     key=/opt/data/cache/listmonk-handoff-private.pem
     pub=/opt/data/cache/listmonk-handoff-public.pem
     env=/opt/data/.env
     staged=/opt/data/.env.listmonk-staged
     cleanup() {
       unset value 2>/dev/null || true
       rm -f "$staged" "$key" "$pub"
     }
     trap cleanup EXIT
     test -r "$key"
     test -r "$env"
     test ! -e "$staged"
     value=$(printf %s "$cipher" | base64 -d | openssl pkeyutl -decrypt \
       -inkey "$key" \
       -pkeyopt rsa_padding_mode:oaep \
       -pkeyopt rsa_oaep_md:sha256)
     case "$value" in
       ""|*[!a-zA-Z0-9]*) exit 1 ;;
     esac
     found=0
     while IFS= read -r line || test -n "$line"; do
       case "$line" in
         MCP_LISTMONK_API_KEY=*)
           printf "MCP_LISTMONK_API_KEY=%s\n" "$value"
           found=1
           ;;
         *) printf "%s\n" "$line" ;;
       esac
     done < "$env" > "$staged"
     if test "$found" -eq 0; then
       printf "MCP_LISTMONK_API_KEY=%s\n" "$value" >> "$staged"
     fi
     chown hermes:hermes "$staged"
     chmod 600 "$staged"
     mv "$staged" "$env"
     unset value
   ' sh "$ciphertext"
   unset ciphertext
   ```

The private key and plaintext staging file stay inside Hermes and are deleted by the same fail-fast operation. If the command fails before cleanup, stop and remove those artifacts only after preserving the failure evidence and confirming `/opt/data/.env` is intact.

The non-secret Hermes configuration must reference the environment variable rather than contain the bearer:

```yaml
mcp_servers:
  listmonk:
    url: http://10.0.3.1:3000/mcp
    headers:
      Authorization: "Bearer ${MCP_LISTMONK_API_KEY}"
    tools:
      include:
        - listmonk_list_subscribers
        - listmonk_get_subscriber
        - listmonk_list_campaigns
        - listmonk_create_campaign
        - listmonk_get_campaign
        - listmonk_get_running_campaign_stats
        - listmonk_get_campaign_analytics
        - listmonk_get_campaign_preview
        - listmonk_preview_campaign_draft
        - listmonk_preview_campaign_text
        - listmonk_convert_campaign_content
        - listmonk_list_templates
        - listmonk_create_template
        - listmonk_get_template
        - listmonk_update_template
        - listmonk_preview_template_draft
        - listmonk_preview_template
        - listmonk_list_lists
        - listmonk_create_list
        - listmonk_get_list
        - listmonk_update_list
        - listmonk_list_media
        - listmonk_upload_media
        - listmonk_get_media
        - listmonk_list_bounces
        - listmonk_get_bounce
        - listmonk_get_public_lists
        - listmonk_get_health
        - listmonk_get_server_config
        - listmonk_get_i18n_lang
        - listmonk_get_dashboard_charts
        - listmonk_get_dashboard_counts
```

## Mandatory preflight

Run every check before restarting either service:

```sh
stat -c '%a %U %G %n' /opt/data/.env /opt/data/config.yaml
runuser -u hermes -- test -r /opt/data/.env
runuser -u hermes -- test -r /opt/data/config.yaml
runuser -u hermes -- /opt/hermes/.venv/bin/python - <<'PY'
from pathlib import Path
import yaml

env = {}
for raw in Path('/opt/data/.env').read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    env[key] = value

bearer = env.get('MCP_LISTMONK_API_KEY', '')
assert bearer.strip(), 'MCP_LISTMONK_API_KEY is missing or empty'

config = yaml.safe_load(Path('/opt/data/config.yaml').read_text())
entry = config['mcp_servers']['listmonk']
assert entry['url'] == 'http://10.0.3.1:3000/mcp'
authorization = entry['headers']['Authorization']
assert authorization.startswith('Bearer ')
assert 'MCP_LISTMONK_API_KEY' in authorization
include = entry.get('tools', {}).get('include')
assert isinstance(include, list) and include, 'Listmonk tool include list is missing or empty'

print('Hermes configuration preflight passed; secret values were not printed.')
PY
```

Expected ownership is `hermes:hermes`. The environment file and protected backups must be mode `0600`. A root-run read or authentication test does not prove the `hermes` service user can start.

## Restart and verification

1. Restart Listmonk from a separate management path so MCP loads the new bearer.
2. Confirm Listmonk and `/healthz` are healthy.
3. Restart Hermes from a separate management path that does not depend on the active Hermes Telegram gateway.
4. Confirm Hermes provider and gateway health.
5. Confirm Listmonk MCP authentication and the exact approved tool list.
6. Confirm send, status-change, campaign-update, test-send, opt-in-send, delete, blocklist, import, subscriber-create/update, and membership-mutation tools are absent.
7. Confirm no bearer value appears in reviewed logs.
8. With a local in-memory probe that reads the protected files without printing values, confirm the new bearer is accepted and the bearer in the timestamped backup receives `401 Unauthorized`.

For rotations only, after every check passes, remove the retained rollback bearer from current package state. Skip this action during an initial transfer because no rotation is pending:

```sh
printf '{}\n' | start-cli package action run listmonk finalize-mcp-bearer-rotation
```

Keep the timestamped protected rollback files until the maintenance window is closed, then remove them through the approved local administration path.

## Rollback

If transfer, preflight, restart, or authentication fails:

1. Stop. Preserve the failing logs and identify whether the mechanism is ownership, parsing, authentication, connectivity, or service startup.
2. Run the package rollback action. It restores the retained prior bearer, clears the failed rotation state, and displays neither value:

```sh
printf '{}\n' | start-cli package action run listmonk rollback-mcp-bearer
```

3. Restore the matching timestamped Hermes files with `install -o hermes -g hermes -m 600`.
4. Repeat the runtime-user readability, non-empty credential, YAML parse, URL, header, and tool-list preflight.
5. If Listmonk had already restarted on the new bearer, restart it once so MCP reloads the rolled-back bearer.
6. Restart Hermes once from the separate management path.
7. Verify health, authentication, exact tools, and logs before declaring recovery.

Do not repeat an unchanged failed restart. Do not finalize a failed rotation.
