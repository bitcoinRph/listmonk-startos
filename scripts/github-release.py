"""GitHub-only, exact-SHA release gate. Only the publish command writes remotely."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any
import zipfile

VERSION = '6.2.0:5'  # Deliberately approve only this release; future versions need review.
ARCHES = ('aarch64', 'x86_64')
ROOT = Path(__file__).resolve().parents[1]


class ApiError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f'GitHub API failed: HTTP {status}')


def api(endpoint, method='GET', fields=None, output=None) -> Any:
    cmd = ['gh', 'api', endpoint, '--method', method]
    for key, value in (fields or {}).items():
        cmd += ['-f', f'{key}={value}']
    result = subprocess.run(cmd, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        status = re.search(rb'HTTP (\d{3})', result.stderr)
        raise ApiError(int(status[1]) if status else 0)
    return None if output else json.loads(result.stdout)


def metadata(root=ROOT):
    text = (root / 'startos/versions/current.ts').read_text()
    matches = re.findall(r'\bversion\s*:\s*([\'\"])([^\'\"\n]+)\1', text)
    if len(matches) != 1 or matches[0][1] != VERSION:
        raise ValueError('Only the reviewed literal version 6.2.0:5 may be released')
    return VERSION, 'v' + VERSION.replace(':', '_')


def context(env=os.environ):
    if env.get('GITHUB_REF') != 'refs/heads/master':
        raise ValueError('Release must run on master')
    if env.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch'):
        raise ValueError('Unsupported release event')
    sha = env.get('GITHUB_SHA', '')
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Expected an exact unmodified commit SHA')
    return sha


def require_absent(repo, tag):
    # Only an explicit 404 means absence; auth/network/server errors must stop us.
    for endpoint in (f'repos/{repo}/git/ref/tags/{tag}', f'repos/{repo}/releases/tags/{tag}'):
        try:
            api(endpoint)
        except ApiError as exc:
            if exc.status == 404:
                continue
            raise
        raise ValueError(f'Tag or release already exists: {tag}; never overwrite')


def preflight():
    sha = context()
    _, tag = metadata()
    repo = os.environ['GITHUB_REPOSITORY']
    if api(f'repos/{repo}/git/ref/heads/master')['object']['sha'] != sha:
        raise ValueError('master moved: refusing stale release')
    require_absent(repo, tag)
    return repo, sha, tag


def check_manifest(m, arch, sha):
    if (m['id'], m['version'], m['gitHash']) != ('listmonk', VERSION, sha):
        raise ValueError('Package ID/version/gitHash does not match release commit')
    if m['hardwareRequirements']['arch'] != [arch]:
        raise ValueError('Incorrect package architecture')
    if set(m['images']) != {'listmonk', 'mcp', 'postgres'} or any(i['arch'] != [arch] for i in m['images'].values()):
        raise ValueError('Incorrect packed image architectures')


def check_artifacts(artifacts, sha):
    expected = {f'listmonk_{arch}.s9pk' for arch in ARCHES}
    if len(artifacts) != 2 or {a['name'] for a in artifacts} != expected:
        raise ValueError('Require exactly the two native package artifacts')
    for a in artifacts:
        if a['expired'] or a['workflow_run']['head_sha'] != sha or not re.fullmatch(r'sha256:[0-9a-f]{64}', a.get('digest') or ''):
            raise ValueError('Expired/unbound artifact or absent SHA256 archive digest')


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_packages(directory, sha, cli='start-cli'):
    if subprocess.check_output([cli, '--version'], text=True).strip() != 'start-cli 2.4.2':
        raise ValueError('Release inspection requires the approved CLI 2.4.2')
    manifests = {}
    for arch in ARCHES:
        name = f'listmonk_{arch}.s9pk'
        package = directory / name
        def inspect(kind):
            return json.loads(subprocess.check_output([cli, 's9pk', 'inspect', str(package), kind]))
        m = inspect('manifest')  # CLI verifies embedded Ed25519 signature at deserialization.
        check_manifest(m, arch, sha)
        inspect('commitment')
        entries = inspect('file-tree')
        if 'manifest.json' not in entries or 'javascript.squashfs' not in entries:
            raise ValueError('Incomplete archive')
        for entry in entries:
            if not entry.endswith('/'):
                # Stream every file to validate its Merkle path/hash, not just its header.
                subprocess.run([cli, 's9pk', 'inspect', str(package), 'cat', entry], stdout=subprocess.DEVNULL, check=True)
        manifests[arch] = m
    (directory / 'manifests.json').write_text(json.dumps(manifests, indent=2) + '\n')
    names = [f'listmonk_{a}.s9pk' for a in ARCHES] + ['manifests.json']
    if (directory / 'provenance.json').exists():
        names.append('provenance.json')
    (directory / 'SHA256SUMS').write_text(''.join(f'{sha256(directory / name)}  {name}\n' for name in names))


def check_build_log(text):
    if not re.search(r'Server Version:\s+29\.9\.2\r?$', text, re.M) or not re.search(r'start-cli: start-cli 2\.4\.2\r?$', text, re.M):
        raise ValueError('Build engine drift; requires fresh review')


def extract_artifact(archive, artifact, directory):
    if 'sha256:' + sha256(archive) != artifact['digest']:
        raise ValueError('Artifact ZIP digest mismatch')
    with zipfile.ZipFile(archive) as z:
        if z.namelist() != [artifact['name']]:
            raise ValueError('Unexpected ZIP members; refuse traversal/extra assets')
        with z.open(artifact['name']) as source, (directory / artifact['name']).open('wb') as dest:
            import shutil
            shutil.copyfileobj(source, dest)


def download(directory, repo, sha):
    run = os.environ['GITHUB_RUN_ID']
    info = api(f'repos/{repo}/actions/runs/{run}')
    if info['head_sha'] != sha or info['head_branch'] != 'master' or info['event'] not in ('push', 'workflow_dispatch'):
        raise ValueError('Run provenance mismatch')
    data = api(f'repos/{repo}/actions/runs/{run}/artifacts?per_page=100')
    if data['total_count'] != len(data['artifacts']):
        raise ValueError('Incomplete artifact listing')
    check_artifacts(data['artifacts'], sha)
    # Reused build workflow installs latest tooling internally. Fail closed if it
    # drifts from the engines actually tested for this approved release.
    jobs = api(f'repos/{repo}/actions/runs/{run}/jobs?per_page=100')
    if jobs['total_count'] != len(jobs['jobs']):
        raise ValueError('Incomplete job listing')
    for target, runner in [('arm', 'ubuntu-24.04-arm'), ('x86', 'ubuntu-latest')]:
        found = [j for j in jobs['jobs'] if j['name'].endswith(f'build / BuildMatrix ({target})')]
        if len(found) != 1 or found[0]['conclusion'] != 'success' or runner not in found[0]['labels']:
            raise ValueError('Missing successful native build job')
        log = directory / f'build-{target}.log'
        with log.open('wb') as stream:
            api(f'repos/{repo}/actions/jobs/{found[0]["id"]}/logs', output=stream)
        text = log.read_text()
        check_build_log(text)
    for a in data['artifacts']:
        archive = directory / (a['name'] + '.zip')
        with archive.open('wb') as stream:
            api(f'repos/{repo}/actions/artifacts/{a["id"]}/zip', output=stream)
        extract_artifact(archive, a, directory)
    (directory / 'provenance.json').write_text(json.dumps({'sha': sha, 'run': run, 'artifacts': data['artifacts'], 'signing': 'Per-architecture ephemeral CI identities, not a trusted persistent publisher'}, indent=2) + '\n')


def publish(directory):
    repo, sha, tag = preflight()
    download(directory, repo, sha)
    verify_packages(directory, sha)
    notes = directory / 'release-notes.md'
    notes.write_text(f'Listmonk {VERSION} for StartOS. Native aarch64 and x86_64 packages.\n\nCommit: {sha}\nBuild: https://github.com/{repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}\n\nPackages use valid ephemeral CI signatures, NOT a trusted persistent publisher identity. Verify SHA256SUMS before sideload. No registry publication. Live installation remains subject to backup and separate lifecycle validation.\n')
    preflight()  # Check again immediately before the first remote write.
    # Creating the ref (never PATCH/force) fails if another actor claimed this tag.
    api(f'repos/{repo}/git/refs', method='POST', fields={'ref': f'refs/tags/{tag}', 'sha': sha})
    if api(f'repos/{repo}/git/ref/tags/{tag}')['object']['sha'] != sha:
        raise ValueError('Created tag SHA mismatch')
    assets = [directory / f'listmonk_{a}.s9pk' for a in ARCHES]
    assets += [directory / name for name in ['SHA256SUMS', 'manifests.json', 'provenance.json']]
    # Draft first: upload all assets before exposing the release. Never clobber.
    subprocess.run(['gh', 'release', 'create', tag, '--repo', repo, '--verify-tag', '--target', sha, '--draft', '--prerelease=false', '--title', tag, '--notes-file', str(notes), *map(str, assets)], check=True)
    release = api(f'repos/{repo}/releases/tags/{tag}')
    check_release_assets(release, assets)
    subprocess.run(['gh', 'release', 'edit', tag, '--repo', repo, '--draft=false', '--prerelease=false', '--latest'], check=True)
    release = api(f'repos/{repo}/releases/tags/{tag}')
    check_release_assets(release, assets)
    if release['target_commitish'] != sha or release['draft'] or release['prerelease'] or api(f'repos/{repo}/git/ref/tags/{tag}')['object']['sha'] != sha:
        raise ValueError('Published release readback mismatch')
    print(release['html_url'])


def check_release_assets(release, assets):
    actual = {a['name']: a for a in release['assets']}
    if set(actual) != {p.name for p in assets}:
        raise ValueError('Release asset set mismatch')
    for p in assets:
        if actual[p.name]['size'] != p.stat().st_size or actual[p.name].get('digest') != 'sha256:' + sha256(p):
            raise ValueError('Published asset size/digest mismatch')


if __name__ == '__main__':
    command = sys.argv[1]
    if command == 'metadata':
        print(*metadata())
    elif command == 'preflight':
        print(*preflight())
    elif command == 'verify':
        verify_packages(Path(sys.argv[2]), sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else 'start-cli')
    elif command == 'publish':
        path = Path('release-assets')
        path.mkdir(exist_ok=False)
        publish(path)
    else:
        raise ValueError('Unknown release command')
