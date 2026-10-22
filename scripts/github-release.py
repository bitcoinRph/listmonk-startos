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

VERSION = None  # Resolved from the reviewed literal source version below.
ARCHES = ('aarch64', 'x86_64')
ROOT = Path(__file__).resolve().parents[1]


class ApiError(RuntimeError):
    def __init__(self, status, category='http', exit_code=None):
        self.status = status
        self.category = category
        self.exit_code = exit_code
        super().__init__(f'GitHub API failed: HTTP {status}; category={category}; gh_exit={exit_code}')


def api(endpoint, method='GET', fields=None, output=None) -> Any:
    cmd = ['gh', 'api', endpoint, '--method', method]
    for key, value in (fields or {}).items():
        cmd += ['-f', f'{key}={value}']
    result = subprocess.run(cmd, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        status = re.search(rb'HTTP (\d{3})', result.stderr)
        # Never expose raw gh stderr: it can contain signed redirect URLs or tokens.
        # Only fixed diagnostic labels leave this boundary; unknown errors fail closed.
        category = 'http' if status else 'unknown'
        if not status:
            stderr = result.stderr.lower()
            for label, markers in [
                ('timeout', (b'timeout', b'deadline exceeded')),
                ('connection-reset', (b'connection reset by peer',)),
                ('unexpected-eof', (b'unexpected eof',)),
                ('tls', (b'x509:', b'tls:')),
                ('dns', (b'no such host',)),
                ('redirect', (b'stopped after 10 redirects',)),
            ]:
                if any(marker in stderr for marker in markers):
                    category = label
                    break
        raise ApiError(int(status[1]) if status else 0, category, result.returncode)
    return None if output else json.loads(result.stdout)


def metadata(root=ROOT):
    text = (root / 'startos/versions/current.ts').read_text()
    matches = re.findall(r'\bversion\s*:\s*([\'\"])([^\'\"\n]+)\1[ \t]*(?=,|\n|$)', text)
    if len(matches) != 1 or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*):(0|[1-9][0-9]*)', matches[0][1]):
        raise ValueError('Require one literal stable ExVer version')
    version = matches[0][1]
    return version, 'v' + version.replace(':', '_')


VERSION = metadata()[0]


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


def verify_packages(directory, sha, cli='start-cli', arches=ARCHES):
    if subprocess.check_output([cli, '--version'], text=True).strip() != 'start-cli 2.4.2':
        raise ValueError('Release inspection requires the approved CLI 2.4.2')
    manifests = {}
    for arch in arches:
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
    names = [f'listmonk_{a}.s9pk' for a in arches] + ['manifests.json']
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


def check_release_assets(release, assets):
    actual = {a['name']: a for a in release['assets']}
    if len(actual) != len(release['assets']) or set(actual) != {p.name for p in assets}:
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
    else:
        raise ValueError('Unknown release command')
