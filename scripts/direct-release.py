"""Quota-free native release transport. No Actions artifacts, job logs, or overwrites.

Trust boundary: only same-repository master workflow code receives contents:write.
Provenance is generated on the native builder and bound to successful run jobs.
"""
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
from urllib.parse import quote
from typing import Any

spec = importlib.util.spec_from_file_location('gate', Path(__file__).with_name('github-release.py'))
assert spec is not None and spec.loader is not None
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
ARCHES = gate.ARCHES
OLD_SHA = '8a92f42fd82daa1daad730363a1614bfeb2614fe'
TOOL_SOURCE = 'Start9Labs/start-technologies@6627e1582d87b6a8fb0ecf32dfc9e660d74f9f33'
CLI_DIGESTS = {
    'aarch64': 'ef71d1cd4961581d0fe2c827cb12ddaa82ea4dda74b06aa0684028436f73eb2b',
    'x86_64': '7b360a7048478e9ab471cf564d9f2a98eb23a25244d1ec7fa1619db355134e6b',
}
NATIVE_NAMES = {f'listmonk_{a}.s9pk' for a in ARCHES} | {f'build-{a}.json' for a in ARCHES}
FINAL_NAMES = NATIVE_NAMES | {'manifests.json', 'provenance.json', 'SHA256SUMS'}


def request(endpoint, method='GET', fields=None, output=None, input_file=None) -> Any:
    # One boundary sanitizes every error, including binary downloads/uploads.
    cmd = ['gh', 'api', endpoint, '--method', method]
    if output:
        cmd += ['-H', 'Accept: application/octet-stream']
    if input_file:
        cmd += ['-H', 'Content-Type: application/octet-stream', '--input', str(input_file)]
    for key, value in (fields or {}).items():
        cmd += ['-F' if isinstance(value, bool) else '-f', f'{key}={str(value).lower() if isinstance(value, bool) else value}']
    result = subprocess.run(cmd, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        status = re.search(rb'HTTP (\d{3})', result.stderr)
        raise gate.ApiError(int(status[1]) if status else 0, 'http' if status else 'transport', result.returncode)
    return None if output else json.loads(result.stdout)


def identity():
    sha = gate.context()
    repo = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid repository')
    run = os.environ['GITHUB_RUN_ID']
    if not re.fullmatch(r'[1-9][0-9]*', run):
        raise ValueError('Invalid run ID')
    info = request(f'repos/{repo}/actions/runs/{run}')
    if (info['head_sha'], info['head_branch'], info['event'], info['repository']['full_name']) != (sha, 'master', os.environ['GITHUB_EVENT_NAME'], repo):
        raise ValueError('Run provenance mismatch')
    if request(f'repos/{repo}/git/ref/heads/master')['object']['sha'] != sha:
        raise ValueError('master moved')
    return repo, sha, run


def tag_name(run):
    tag = gate.metadata()[1]
    if os.environ.get('RELEASE_RC', 'false') == 'true':
        if os.environ['GITHUB_EVENT_NAME'] != 'workflow_dispatch':
            raise ValueError('RC requires manual master dispatch')
        tag += f'-rc.{run}.{os.environ["GITHUB_RUN_ATTEMPT"]}'
    return tag


def asset_map(release, expected):
    assets = release['assets']
    result = {a['name']: a for a in assets}
    if len(result) != len(assets) or set(result) != set(expected):
        raise ValueError('Release asset set mismatch')
    for name, a in result.items():
        if Path(name).name != name or a['size'] <= 0 or a['size'] >= 2 * 1024**3 or not re.fullmatch(r'sha256:[0-9a-f]{64}', a.get('digest') or ''):
            raise ValueError('Invalid release asset name/size/digest')
    return result


def begin():
    repo, sha, run = identity()
    tag = tag_name(run)
    try:
        ref = request(f'repos/{repo}/git/ref/tags/{tag}')
    except gate.ApiError as exc:
        if exc.status != 404:
            raise
    else:
        # The existing stable is immutable, including its embedded old gitHash.
        # Legacy assets predate per-builder JSON; new releases require it too.
        release = request(f'repos/{repo}/releases/tags/{tag}')
        legacy = {'listmonk_aarch64.s9pk', 'listmonk_x86_64.s9pk', 'SHA256SUMS', 'manifests.json', 'provenance.json'}
        released_sha = ref['object']['sha']
        if not re.fullmatch('[0-9a-f]{40}', released_sha) or release['target_commitish'] != released_sha or release['draft'] or release['prerelease']:
            raise ValueError('Existing tag/release: never overwrite; review required')
        if tag == 'v6.2.0_5' and released_sha != OLD_SHA:
            raise ValueError('Audited legacy release SHA mismatch')
        asset_map(release, legacy if tag == 'v6.2.0_5' else FINAL_NAMES)
        output('build', 'false')
        print(f'Already released/no-op: {tag} at {released_sha}; no writes')
        return
    # Drafts are not reliably addressable by tag. Enumerate by ID before writes.
    page = 1
    while True:
        releases = request(f'repos/{repo}/releases?per_page=100&page={page}')
        if any(r['tag_name'] == tag for r in releases):
            raise ValueError('Existing release/draft: never overwrite')
        if len(releases) < 100:
            break
        page += 1
    # Do not create a tag until BOTH native packages have passed final verification.
    release = request(f'repos/{repo}/releases', 'POST', {
        'tag_name': tag, 'target_commitish': sha, 'name': tag,
        'draft': True, 'prerelease': os.environ.get('RELEASE_RC') == 'true',
        'body': f'Commit: {sha}\nBuild: https://github.com/{repo}/actions/runs/{run}\nEphemeral CI signatures, not a trusted persistent publisher. No registry publication. Verify SHA256SUMS. Live installation requires separate approval.',
    })
    rid = str(release['id'])
    bound_draft(repo, sha, run, rid)
    output('release_id', rid)
    output('build', 'true')


def output(key, value):
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as stream:
        stream.write(f'{key}={value}\n')


def bound_draft(repo, sha, run, rid):
    if not re.fullmatch(r'[1-9][0-9]*', rid):
        raise ValueError('Require numeric draft release ID')
    release = request(f'repos/{repo}/releases/{rid}')  # Never look up a draft by tag.
    if f'https://github.com/{repo}/actions/runs/{run}' not in release.get('body', '') or (str(release['id']), release['tag_name'], release['target_commitish'], release['draft'], release['prerelease']) != (rid, tag_name(run), sha, True, os.environ.get('RELEASE_RC') == 'true'):
        raise ValueError('Draft identity mismatch')
    return release


def upload(repo, sha, run, rid, path):
    if path.name not in FINAL_NAMES or path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size < 2 * 1024**3:
        raise ValueError('Invalid upload path/size')
    release = bound_draft(repo, sha, run, rid)
    if any(a['name'] == path.name for a in release['assets']):
        raise ValueError('Asset already exists; never overwrite')
    request(f'https://uploads.github.com/repos/{repo}/releases/{rid}/assets?name={quote(path.name, safe="")}', 'POST', input_file=path)
    release = bound_draft(repo, sha, run, rid)
    assets = [a for a in release['assets'] if a['name'] == path.name]
    gate.check_release_assets({'assets': assets}, [path])


def engines(arch):
    if arch not in ARCHES or platform.machine() != arch:
        raise ValueError('Build must use the matching native runner')
    docker = json.loads(subprocess.check_output(['docker', 'version', '--format', '{{json .}}'], text=True))
    cli = subprocess.check_output(['start-cli', '--version'], text=True).strip()
    expected_docker_arch = {'aarch64': 'arm64', 'x86_64': 'amd64'}[arch]
    if docker['Server']['Version'] != '29.9.2' or docker['Server']['Arch'] != expected_docker_arch or cli != 'start-cli 2.4.2':
        raise ValueError('Build engine drift; requires fresh review')
    cli_path = Path(subprocess.check_output(['which', 'start-cli'], text=True).strip())
    digest = gate.sha256(cli_path)
    if digest != CLI_DIGESTS[arch]:
        raise ValueError('CLI binary differs from exact official release asset')
    # Only allowlisted values; never capture environment, daemon auth, or logs.
    return {'docker_server': docker['Server']['Version'], 'docker_server_arch': docker['Server']['Arch'],
            'cli_version': cli, 'cli_sha256': digest, 'cli_source': 'Start9Labs/start-technologies/releases/tag/start-cli/v2.4.2',
            'build_recipe_source': TOOL_SOURCE, 'native_arch': arch}


def native(directory, arch, rid):
    repo, sha, run = identity()
    bound_draft(repo, sha, run, rid)
    tools = engines(arch)
    gate.verify_packages(directory, sha, arches=(arch,))
    package = directory / f'listmonk_{arch}.s9pk'
    p = {'sha': sha, 'run': run, 'attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'repository': repo,
         'release_id': rid, 'job_name': f'native ({arch})', 'tools': tools,
         'package': {'name': package.name, 'sha256': gate.sha256(package), 'size': package.stat().st_size}}
    path = directory / f'build-{arch}.json'
    path.write_text(json.dumps(p, indent=2) + '\n')
    upload(repo, sha, run, rid, package)
    upload(repo, sha, run, rid, path)


def successful_jobs(repo, sha, run):
    info = request(f'repos/{repo}/actions/runs/{run}')
    attempt = os.environ['GITHUB_RUN_ATTEMPT']
    if info['head_sha'] != sha or str(info['run_attempt']) != attempt:
        raise ValueError('Run SHA/attempt mismatch')
    jobs = request(f'repos/{repo}/actions/runs/{run}/attempts/{attempt}/jobs?per_page=100')
    if jobs['total_count'] != len(jobs['jobs']):
        raise ValueError('Incomplete job listing')
    result = {}
    for arch, runner in [('aarch64', 'ubuntu-24.04-arm'), ('x86_64', 'ubuntu-latest')]:
        found = [j for j in jobs['jobs'] if j['name'] == f'native ({arch})']
        if len(found) != 1 or found[0]['conclusion'] != 'success' or runner not in found[0]['labels'] or found[0]['head_sha'] != sha:
            raise ValueError('Missing successful native build check')
        result[arch] = {'id': found[0]['id'], 'check_run_url': found[0]['check_run_url'], 'runner': runner}
    return result


def finish(directory, rid):
    repo, sha, run = identity()
    release = bound_draft(repo, sha, run, rid)
    assets = asset_map(release, NATIVE_NAMES)
    jobs = successful_jobs(repo, sha, run)
    directory.mkdir(exist_ok=False)
    # Only use hard-coded safe asset names, not server-provided paths/URLs.
    for name in sorted(NATIVE_NAMES):
        p = directory / name
        with p.open('xb') as stream:
            request(f'repos/{repo}/releases/assets/{int(assets[name]["id"])}', output=stream)
        gate.check_release_assets({'assets': [assets[name]]}, [p])
    provenance = {}
    for arch in ARCHES:
        p = json.loads((directory / f'build-{arch}.json').read_text())
        package = directory / f'listmonk_{arch}.s9pk'
        if (p['sha'], p['run'], p['attempt'], p['repository'], p['release_id'], p['job_name']) != (sha, run, os.environ['GITHUB_RUN_ATTEMPT'], repo, rid, f'native ({arch})'):
            raise ValueError('Build provenance binding mismatch')
        tools = p['tools']
        if (tools['docker_server'], tools['docker_server_arch'], tools['cli_version'], tools['cli_sha256'], tools['native_arch'], tools['build_recipe_source'], tools['cli_source']) != ('29.9.2', {'aarch64': 'arm64', 'x86_64': 'amd64'}[arch], 'start-cli 2.4.2', CLI_DIGESTS[arch], arch, TOOL_SOURCE, 'Start9Labs/start-technologies/releases/tag/start-cli/v2.4.2'):
            raise ValueError('Build engine provenance drift')
        if p['package'] != {'name': package.name, 'sha256': gate.sha256(package), 'size': package.stat().st_size}:
            raise ValueError('Package provenance mismatch')
        provenance[arch] = {'builder': p, 'github_check': jobs[arch]}
    (directory / 'provenance.json').write_text(json.dumps({'sha': sha, 'run': run, 'native': provenance, 'signing': 'Per-architecture ephemeral CI identities, not a trusted persistent publisher'}, indent=2) + '\n')
    gate.verify_packages(directory, sha)  # Full signatures + every Merkle path, both arches.
    (directory / 'SHA256SUMS').write_text(''.join(f'{gate.sha256(directory / n)}  {n}\n' for n in sorted(FINAL_NAMES - {'SHA256SUMS'})))
    for name in ['manifests.json', 'provenance.json', 'SHA256SUMS']:
        upload(repo, sha, run, rid, directory / name)
    release = bound_draft(repo, sha, run, rid)
    paths = [directory / name for name in sorted(FINAL_NAMES)]
    gate.check_release_assets(release, paths)
    if os.environ.get('RELEASE_RC') == 'true':
        print(f'Verified draft RC ID {rid}; remains unpublished, no stable tag created')
        return
    identity()  # Head must remain exact immediately before claiming a stable tag.
    # Draft exists: only tag absence is meaningful here, never lookup by tag.
    try:
        request(f'repos/{repo}/git/ref/tags/{tag_name(run)}')
    except gate.ApiError as exc:
        if exc.status != 404:
            raise
    else:
        raise ValueError('Tag already exists; never overwrite')
    request(f'repos/{repo}/git/refs', 'POST', {'ref': f'refs/tags/{tag_name(run)}', 'sha': sha})
    if request(f'repos/{repo}/git/ref/tags/{tag_name(run)}')['object']['sha'] != sha:
        raise ValueError('Created tag mismatch')
    request(f'repos/{repo}/releases/{rid}', 'PATCH', {'draft': False, 'prerelease': False, 'make_latest': 'true'})
    release = request(f'repos/{repo}/releases/{rid}')
    gate.check_release_assets(release, paths)
    if release['draft'] or release['prerelease'] or release['target_commitish'] != sha or request(f'repos/{repo}/git/ref/tags/{tag_name(run)}')['object']['sha'] != sha:
        raise ValueError('Published release readback mismatch')
    print(release['html_url'])


if __name__ == '__main__':
    command = sys.argv[1]
    if command == 'begin':
        begin()
    elif command == 'engines':
        print(json.dumps(engines(sys.argv[2]), sort_keys=True))
    elif command == 'native':
        native(Path('.'), sys.argv[2], sys.argv[3])
    elif command == 'finish':
        finish(Path('release-assets'), sys.argv[2])
    else:
        raise ValueError('Unknown command')
