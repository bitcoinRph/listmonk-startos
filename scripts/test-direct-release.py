"""Offline direct-release regressions. All fixtures are synthetic, never credentials."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('direct', Path(__file__).with_name('direct-release.py'))
assert spec is not None and spec.loader is not None
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
SHA = 'a' * 40
REPO = 'owner/repo'
ENV = {'GITHUB_REF': 'refs/heads/master', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_SHA': SHA,
       'GITHUB_REPOSITORY': REPO, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'RELEASE_RC': 'false'}


def draft():
    return {'id': 42, 'tag_name': r.gate.metadata()[1], 'target_commitish': SHA, 'draft': True,
            'prerelease': False, 'body': 'https://github.com/owner/repo/actions/runs/123', 'assets': []}


def asset(name, data=b'fixture'):
    import hashlib
    return {'name': name, 'id': 1, 'size': len(data), 'digest': 'sha256:' + hashlib.sha256(data).hexdigest()}


class DirectTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_bound_draft_uses_numeric_id_not_tag(self):
        with patch.object(r, 'request', return_value=draft()) as api:
            r.bound_draft(REPO, SHA, '123', '42')
            api.assert_called_once_with('repos/owner/repo/releases/42')
        for rid in ['', '../42', '42?x', '0']:
            with patch.object(r, 'request') as api, self.assertRaises(ValueError):
                r.bound_draft(REPO, SHA, '123', rid)
            api.assert_not_called()

    def test_draft_identity_rejects_wrong_sha_run_tag_or_publication(self):
        for key, value in [('id', 43), ('tag_name', 'other'), ('target_commitish', 'b' * 40), ('draft', False), ('prerelease', True), ('body', 'other run')]:
            with self.subTest(key=key), patch.object(r, 'request', return_value=dict(draft(), **{key: value})), self.assertRaises(ValueError):
                r.bound_draft(REPO, SHA, '123', '42')

    def test_rc_is_manual_master_and_unique(self):
        with self.assertRaises(ValueError), patch.dict(os.environ, RELEASE_RC='true'):
            r.tag_name('123')
        with patch.dict(os.environ, RELEASE_RC='true', GITHUB_EVENT_NAME='workflow_dispatch'):
            self.assertEqual(r.tag_name('123'), r.gate.metadata()[1] + '-rc.123.1')

    def test_asset_set_missing_arch_duplicate_extra_traversal_bad_digest_size(self):
        valid = {'assets': [asset(n) for n in r.NATIVE_NAMES]}
        r.asset_map(valid, r.NATIVE_NAMES)
        for bad in [valid['assets'][:-1], valid['assets'] + [valid['assets'][0]], valid['assets'] + [asset('../escape')]]:
            with self.assertRaises(ValueError):
                r.asset_map({'assets': bad}, r.NATIVE_NAMES)
        for field, value in [('digest', None), ('size', 0), ('size', 2 * 1024**3)]:
            bad = copy.deepcopy(valid)
            bad['assets'][0][field] = value
            with self.assertRaises(ValueError):
                r.asset_map(bad, r.NATIVE_NAMES)

    def test_upload_no_overwrite_and_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'listmonk_x86_64.s9pk'
            p.write_bytes(b'fixture')
            d = draft(); d['assets'] = [asset(p.name)]
            with patch.object(r, 'bound_draft', return_value=d), patch.object(r, 'request') as api, self.assertRaises(ValueError):
                r.upload(REPO, SHA, '123', '42', p)
            api.assert_not_called()
            link = Path(tmp) / 'build-x86_64.json'; link.symlink_to(p)
            with patch.object(r, 'request') as api, self.assertRaises(ValueError):
                r.upload(REPO, SHA, '123', '42', link)
            api.assert_not_called()

    def test_upload_by_id_and_exact_digest_readback(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'listmonk_x86_64.s9pk'; p.write_bytes(b'fixture')
            after = draft(); after['assets'] = [asset(p.name)]
            with patch.object(r, 'bound_draft', side_effect=[draft(), after]), patch.object(r, 'request') as api:
                r.upload(REPO, SHA, '123', '42', p)
                self.assertIn('/releases/42/assets?name=', api.call_args.args[0])
                self.assertEqual(api.call_args.kwargs['input_file'], p)
            after['assets'][0]['digest'] = 'sha256:' + '0' * 64
            with patch.object(r, 'bound_draft', side_effect=[draft(), after]), patch.object(r, 'request'), self.assertRaises(ValueError):
                r.upload(REPO, SHA, '123', '42', p)

    def test_existing_stable_noop_is_read_only_preserves_old_sha(self):
        d = draft(); d.update(tag_name='v6.2.0_5', target_commitish=r.OLD_SHA, draft=False)
        names = {'listmonk_aarch64.s9pk', 'listmonk_x86_64.s9pk', 'SHA256SUMS', 'manifests.json', 'provenance.json'}
        d['assets'] = [asset(n) for n in names]
        with patch.object(r, 'identity', return_value=(REPO, SHA, '123')), patch.object(r.gate, 'metadata', return_value=('6.2.0:5', 'v6.2.0_5')), patch.object(r, 'request', side_effect=[{'object': {'sha': r.OLD_SHA}}, d]) as api, patch.object(r, 'output') as output:
            r.begin()
            output.assert_called_once_with('build', 'false')
            self.assertTrue(all(len(c.args) == 1 for c in api.call_args_list))

    def test_preflight_errors_never_write(self):
        for code in [0, 403, 500]:
            with patch.object(r, 'identity', return_value=(REPO, SHA, '123')), patch.object(r, 'request', side_effect=r.gate.ApiError(code)) as api, self.assertRaises(r.gate.ApiError):
                r.begin()
            api.assert_called_once()

    def test_existing_draft_detected_by_listing_not_tag(self):
        with patch.object(r, 'identity', return_value=(REPO, SHA, '123')), patch.object(r, 'request', side_effect=[r.gate.ApiError(404), [draft()]]) as api, self.assertRaises(ValueError):
            r.begin()
        self.assertIn('releases?per_page=100', api.call_args.args[0])
        self.assertTrue(all(len(c.args) == 1 for c in api.call_args_list))

    def test_draft_create_explicit_flags_and_id_readback(self):
        with patch.object(r, 'identity', return_value=(REPO, SHA, '123')), patch.object(r, 'request', side_effect=[r.gate.ApiError(404), [], draft()]) as api, patch.object(r, 'bound_draft') as bound, patch.object(r, 'output'):
            r.begin()
            fields = api.call_args.args[2]
            self.assertIs(fields['draft'], True)
            self.assertIs(fields['prerelease'], False)
            bound.assert_called_once_with(REPO, SHA, '123', '42')

    def test_real_engine_command_schema_and_digest_pins(self):
        docker = json.dumps({'Server': {'Version': '29.9.2', 'Arch': 'amd64'}})
        values = [docker, 'start-cli 2.4.2\n', '/official/start-cli\n']
        with patch.object(r.platform, 'machine', return_value='x86_64'), patch.object(r.subprocess, 'check_output', side_effect=values) as command, patch.object(r.gate, 'sha256', return_value=r.CLI_DIGESTS['x86_64']):
            tools = r.engines('x86_64')
            self.assertEqual(tools['docker_server'], '29.9.2')
            self.assertEqual(command.call_args_list[0].args[0], ['docker', 'version', '--format', '{{json .}}'])
        for version, arch in [('29.9.3', 'amd64'), ('29.9.2-beta', 'amd64'), ('29.9.2', 'arm64')]:
            with patch.object(r.platform, 'machine', return_value='x86_64'), patch.object(r.subprocess, 'check_output', side_effect=[json.dumps({'Server': {'Version': version, 'Arch': arch}}), 'start-cli 2.4.2']), self.assertRaises(ValueError):
                r.engines('x86_64')

    def test_wrong_native_runner_fails_before_commands(self):
        with patch.object(r.platform, 'machine', return_value='x86_64'), patch.object(r.subprocess, 'check_output') as command, self.assertRaises(ValueError):
            r.engines('aarch64')
        command.assert_not_called()

    def test_native_bad_signature_never_uploads(self):
        with patch.object(r, 'identity', return_value=(REPO, SHA, '123')), patch.object(r, 'bound_draft'), patch.object(r, 'engines'), patch.object(r.gate, 'verify_packages', side_effect=ValueError('bad signature')), patch.object(r, 'upload') as upload, self.assertRaises(ValueError):
            r.native(Path('.'), 'x86_64', '42')
        upload.assert_not_called()

    def test_job_checks_exact_sha_attempt_native_labels_complete_listing(self):
        jobs = [{'name': f'native ({a})', 'conclusion': 'success', 'labels': [label], 'head_sha': SHA, 'id': i, 'check_run_url': f'https://api.github.com/check-runs/{i}'} for i, (a, label) in enumerate([('aarch64', 'ubuntu-24.04-arm'), ('x86_64', 'ubuntu-latest')])]
        info = {'head_sha': SHA, 'run_attempt': 1}
        with patch.object(r, 'request', side_effect=[info, {'total_count': 2, 'jobs': jobs}]) as api:
            self.assertEqual(set(r.successful_jobs(REPO, SHA, '123')), set(r.ARCHES))
            self.assertIn('/attempts/1/jobs', api.call_args.args[0])
        for field, val in [('head_sha', 'b' * 40), ('conclusion', 'failure'), ('labels', ['ubuntu-latest'])]:
            bad = copy.deepcopy(jobs); bad[0][field] = val
            with patch.object(r, 'request', side_effect=[info, {'total_count': 2, 'jobs': bad}]), self.assertRaises(ValueError):
                r.successful_jobs(REPO, SHA, '123')
        with patch.object(r, 'request', side_effect=[info, {'total_count': 3, 'jobs': jobs}]), self.assertRaises(ValueError):
            r.successful_jobs(REPO, SHA, '123')

    def test_missing_arch_prevents_finalization_writes(self):
        d = draft(); d['assets'] = [asset('listmonk_x86_64.s9pk')]
        with patch.object(r, 'identity', return_value=(REPO, SHA, '123')), patch.object(r, 'bound_draft', return_value=d), patch.object(r, 'request') as api, self.assertRaises(ValueError):
            r.finish(Path('never-created'), '42')
        api.assert_not_called()

    def test_transport_is_secret_safe_and_explicit_boolean_typed(self):
        error = subprocess.CompletedProcess([], 1, b'', b'opaque SYNTHETIC_SECRET signed-url')
        with patch.object(r.subprocess, 'run', return_value=error), self.assertRaises(r.gate.ApiError) as raised:
            r.request('endpoint')
        self.assertNotIn('SYNTHETIC', str(raised.exception))
        ok = subprocess.CompletedProcess([], 0, b'{}', b'')
        with patch.object(r.subprocess, 'run', return_value=ok) as run:
            r.request('endpoint', 'POST', {'draft': True, 'prerelease': False})
        self.assertEqual(run.call_args.args[0][-4:], ['-F', 'draft=true', '-F', 'prerelease=false'])

    def test_future_literal_versions_allowed_but_not_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'startos/versions').mkdir(parents=True)
            p = root / 'startos/versions/current.ts'
            p.write_text("version: '6.3.0:0'")
            self.assertEqual(r.gate.metadata(root), ('6.3.0:0', 'v6.3.0_0'))
            for bad in ['../6', '6.3.0:0/escape', '6.3.0:0-beta', '06.3.0:0']:
                p.write_text(f"version: '{bad}'")
                with self.assertRaises(ValueError):
                    r.gate.metadata(root)

    def exercise_finish(self, rc=False, corrupt=None, signature_failure=False):
        """Local stateful API double; never a live GitHub release operation."""
        import hashlib
        payloads = {}
        for arch in r.ARCHES:
            name = f'listmonk_{arch}.s9pk'
            payloads[name] = f'synthetic {arch} package'.encode()
            p = {'sha': SHA, 'run': '123', 'attempt': '1', 'repository': REPO,
                 'release_id': '42', 'job_name': f'native ({arch})',
                 'tools': {'docker_server': '29.9.2', 'docker_server_arch': {'aarch64': 'arm64', 'x86_64': 'amd64'}[arch],
                           'cli_version': 'start-cli 2.4.2', 'cli_sha256': r.CLI_DIGESTS[arch], 'native_arch': arch,
                           'build_recipe_source': r.TOOL_SOURCE, 'cli_source': 'Start9Labs/start-technologies/releases/tag/start-cli/v2.4.2'},
                 'package': {'name': name, 'sha256': hashlib.sha256(payloads[name]).hexdigest(), 'size': len(payloads[name])}}
            if arch == 'aarch64' and corrupt:
                if corrupt == 'engine':
                    p['tools']['docker_server'] = '29.9.3'
                elif corrupt == 'sha':
                    p['sha'] = 'b' * 40
                elif corrupt == 'digest':
                    p['package']['sha256'] = '0' * 64
            payloads[f'build-{arch}.json'] = json.dumps(p).encode()
        d = draft()
        d['prerelease'] = rc
        if rc:
            d['tag_name'] = r.gate.metadata()[1] + '-rc.123.1'
        d['assets'] = [dict(asset(n, payloads[n]), id=i) for i, n in enumerate(sorted(payloads), 1)]
        writes = []
        tagged = False

        def api(endpoint, method='GET', fields=None, output=None, input_file=None):
            nonlocal tagged
            if output:
                a = next(a for a in d['assets'] if endpoint.endswith('/' + str(a['id'])))
                output.write(payloads[a['name']])
                return
            if method == 'POST' and input_file:
                writes.append(input_file.name)
                payloads[input_file.name] = input_file.read_bytes()
                d['assets'].append(dict(asset(input_file.name, payloads[input_file.name]), id=len(d['assets']) + 1))
                return {}
            if method == 'POST' and endpoint.endswith('/git/refs'):
                writes.append('tag'); tagged = True
                self.assertEqual(fields['sha'], SHA)
                return {}
            if '/git/ref/tags/' in endpoint:
                if not tagged:
                    raise r.gate.ApiError(404)
                return {'object': {'sha': SHA}}
            if method == 'PATCH':
                writes.append('publish'); d['draft'] = False
                self.assertIs(fields['prerelease'], False)
                d['html_url'] = 'https://github.com/owner/repo/releases/tag/test-fixture'
            self.assertTrue(endpoint.endswith('/releases/42'))
            return copy.deepcopy(d)

        def verify(directory, sha):
            self.assertEqual(sha, SHA)
            if signature_failure:
                raise ValueError('synthetic signature failure')
            (directory / 'manifests.json').write_text('{}\n')

        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, RELEASE_RC='true' if rc else 'false', GITHUB_EVENT_NAME='workflow_dispatch' if rc else 'push'), patch.object(r, 'identity', return_value=(REPO, SHA, '123')), patch.object(r, 'successful_jobs', return_value={a: {'id': i} for i, a in enumerate(r.ARCHES)}), patch.object(r, 'request', side_effect=api), patch.object(r.gate, 'verify_packages', side_effect=verify):
            if corrupt or signature_failure:
                with self.assertRaises(ValueError):
                    r.finish(Path(tmp) / 'assets', '42')
                self.assertEqual(writes, [])
            else:
                directory = Path(tmp) / 'assets'
                r.finish(directory, '42')
                self.assertEqual(set(payloads), r.FINAL_NAMES)
                lines = (directory / 'SHA256SUMS').read_text().splitlines()
                self.assertEqual(len(lines), len(r.FINAL_NAMES) - 1)
                for line in lines:
                    digest, name = line.split('  ')
                    self.assertEqual(digest, hashlib.sha256(payloads[name]).hexdigest())
                self.assertEqual(d['draft'], rc)
                self.assertEqual(writes[-2:] if not rc else writes, ['tag', 'publish'] if not rc else ['manifests.json', 'provenance.json', 'SHA256SUMS'])

    def test_finish_stable_direct_bytes_checksums_and_id_publication(self):
        self.exercise_finish()

    def test_finish_manual_rc_stays_draft_without_tag(self):
        self.exercise_finish(rc=True)

    def test_finish_bad_provenance_never_writes(self):
        for corruption in ['engine', 'sha', 'digest']:
            with self.subTest(corruption=corruption):
                self.exercise_finish(corrupt=corruption)

    def test_finish_bad_signature_never_writes(self):
        self.exercise_finish(signature_failure=True)

    def test_no_artifact_or_job_log_endpoint_remains(self):
        text = Path(__file__).with_name('direct-release.py').read_text()
        for bad in ['/logs', '/artifacts', '--clobber', 'os.environ.items', 'print(os.environ']:
            self.assertNotIn(bad, text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
