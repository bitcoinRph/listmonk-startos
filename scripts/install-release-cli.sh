#!/usr/bin/env bash
# Exact official release binaries, not the mutable latest installer.
set -euo pipefail
arch=$(uname -m)
case "$arch" in
  aarch64) digest=ef71d1cd4961581d0fe2c827cb12ddaa82ea4dda74b06aa0684028436f73eb2b ;;
  x86_64) digest=7b360a7048478e9ab471cf564d9f2a98eb23a25244d1ec7fa1619db355134e6b ;;
  *) exit 1 ;;
esac
file="$RUNNER_TEMP/start-cli-$arch"
curl -fsSL "https://github.com/Start9Labs/start-technologies/releases/download/start-cli/v2.4.2/start-cli_${arch}-linux" -o "$file"
printf '%s  %s\n' "$digest" "$file" | sha256sum --check
sudo install -m 755 "$file" /usr/local/bin/start-cli
test "$(start-cli --version)" = 'start-cli 2.4.2'
