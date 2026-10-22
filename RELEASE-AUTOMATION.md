# GitHub-only native release automation

The release workflow stores deliverables as **versioned assets on this repository's GitHub Releases**, not GitHub Actions artifacts. GitHub-hosted runners and normal Actions compute limits still apply. No registry, installation, or service restart is performed.

## Stable releases

1. Review the package changes and literal stable ExVer in `startos/versions/current.ts`, then merge to `master`.
2. The workflow runs TypeScript, MCP/root tests, release tests, and actionlint before any remote writes.
3. An already published complete version is a read-only no-op. In particular, `v6.2.0_5` remains at `8a92f42fd82daa1daad730363a1614bfeb2614fe`, including its original manifest `gitHash`. A workflow-only merge does not create a new stable release or rewrite an old one.
4. For a new version, preflight checks exact master SHA and run/repository identity, rejects existing tags and drafts, and creates a draft with an explicit target SHA. The returned numeric release ID is passed to both native jobs and finalization. Drafts are never located by tag.
5. `ubuntu-24.04-arm` builds `make arm`; `ubuntu-latest` builds `make x86`. Each runner creates its own ephemeral signing identity and minimal `.startos` workspace. Native builds use the reviewed official Start9 primary commands (init-key, workspace key copy, npm ci, make target); QEMU and optional mirror retry are not needed for the two native targets.
6. Docker Engine is pinned to `29.9.2`; the real Docker server version and architecture are checked before and after building. Start CLI is pinned to official `start-cli/v2.4.2` release binaries with per-architecture SHA256 checks and a real `--version` check. Mutable latest-tool installers are not used.
7. Each native job verifies the package manifest, exact source `gitHash`, architecture, Ed25519 signature, commitment and every file's Merkle path. It writes allowlisted engine/package provenance from real command output and uploads its package plus `build-<arch>.json` directly to the draft ID. Every upload has size/digest readback and refuses existing names.
8. Finalization requires successful matching native GitHub job checks for this exact run attempt/SHA and native runner labels. It downloads assets by numeric asset ID, verifies API digests/size, validates provenance, and repeats full package verification. It uploads `manifests.json`, `provenance.json`, and `SHA256SUMS` before creating the stable tag with a non-force POST. Only then is the draft published by ID and read back.

Each new complete release has seven assets:

- `listmonk_aarch64.s9pk`
- `listmonk_x86_64.s9pk`
- `build-aarch64.json`
- `build-x86_64.json`
- `manifests.json`
- `provenance.json`
- `SHA256SUMS` (covers the other six assets)

These are valid ephemeral CI signatures, **not a trusted persistent publisher identity**. No secrets are forwarded to builders. Provenance includes the real CLI binary digest, Docker server version/architecture, recipe source, package bytes, run attempt, and GitHub check references; it does not claim to be an independent hardware attestation.

## Manual draft RC for workflow-only changes

After reviewed code is on `master`, an authorized operator can test the quota-free delivery path without bumping or publishing the stable package version:

```sh
gh workflow run release.yml --repo bitcoinRph/listmonk-startos --ref master -f draft_rc=true
```

This is an external write and needs publication approval. It has **not** been dispatched as part of the local repair. The workflow uses a unique `v<version>-rc.<run-id>.<attempt>` draft, builds/verifies both native packages, attaches all seven assets, and leaves the RC unpublished without creating a stable tag or changing Latest. Only same-repository `master` dispatch is trusted; PRs/forks receive no release write path.

## Failures and recovery

No automatic deletion, clobbering, resume-over-existing-assets, or tag replacement is allowed. A failed build may leave a partial draft for inspection. A repeated stable attempt for the same version fails closed if a draft already exists; investigate separately rather than blindly retrying publication. For RCs, a fresh dispatch gives a distinct draft name. A failure after stable tag creation is also deliberately fail-closed and requires an explicit reviewed recovery, not force-pushing or deleting the tag.

The build workflow now runs checks/tests only on PRs and ordinary pushes. Native packaging and downloadable output occur in the trusted release workflow (new stable version or explicit draft RC), avoiding a second Actions-artifact quota dependency.

## Local validation

```sh
npm ci
npm ci --prefix mcp --omit=dev --ignore-scripts
npm run check
npm test
python3 scripts/test-release.py
python3 scripts/test-direct-release.py
actionlint
bash -n scripts/install-release-cli.sh
git diff --check
```

The direct-release tests use clearly labeled synthetic offline API doubles. They do not publish live releases or represent a live native CI build. Package inspection can be exercised separately against genuine existing packages using the approved CLI:

```sh
python3 scripts/github-release.py verify <scratch-package-directory> <exact-source-sha> <path-to-start-cli-2.4.2>
```

## Authorities

- [Start9 environment/workspace setup](https://docs.start9.com/packaging/0.4.0.x/environment-setup.html)
- [Pinned official native build recipe](https://github.com/Start9Labs/start-technologies/blob/6627e1582d87b6a8fb0ecf32dfc9e660d74f9f33/.github/workflows/build.yml)
- [Official Start CLI 2.4.2 assets](https://github.com/Start9Labs/start-technologies/releases/tag/start-cli/v2.4.2)
- [GitHub About Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas): each asset must be under 2 GiB; no total release-size or bandwidth limit is stated, with up to 1000 assets per release. This storage path is distinct from Actions artifacts.
