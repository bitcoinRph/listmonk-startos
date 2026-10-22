"""Workflow-only regression tests; no network or publication."""
import copy
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('release', ROOT / 'scripts/github-release.py')
        assert spec is not None and spec.loader is not None
        cls.r = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.r)

    def test_api_failure_diagnostics_are_safe_and_do_not_retry(self):
        import subprocess
        # Synthetic secrets and signed redirect only; never live credentials.
        secret = b'https://logs.example/private?sig=SYNTHETIC_SECRET Authorization: Bearer SYNTHETIC_TOKEN'
        cases = [
            (b'gh: Forbidden (HTTP 403) ' + secret, 403, 'http'),
            (b'Get "' + secret + b'": net/http: TLS handshake timeout', 0, 'timeout'),
            (b'Get "' + secret + b'": connection reset by peer', 0, 'connection-reset'),
            (b'Get "' + secret + b'": unexpected EOF', 0, 'unexpected-eof'),
            (b'Get "' + secret + b'": x509: certificate signed by unknown authority', 0, 'tls'),
            (b'Get "' + secret + b'": no such host', 0, 'dns'),
            (b'Get "' + secret + b'": stopped after 10 redirects', 0, 'redirect'),
            (b'unknown failure ' + secret, 0, 'unknown'),
        ]
        for stderr, status, category in cases:
            with self.subTest(category=category), patch.object(self.r.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', stderr)) as run:
                with self.assertRaises(self.r.ApiError) as raised:
                    self.r.api('repos/owner/repo/actions/jobs/123/logs')
                error = raised.exception
                self.assertEqual(error.status, status)
                self.assertEqual(getattr(error, 'category', None), category)
                self.assertEqual(getattr(error, 'exit_code', None), 1)
                self.assertEqual(str(error), f'GitHub API failed: HTTP {status}; category={category}; gh_exit=1')
                self.assertNotIn('SYNTHETIC', repr(vars(error)) + str(error))
                run.assert_called_once()

    def test_actual_metadata(self):
        version, tag = self.r.metadata(ROOT)
        self.assertEqual(version, self.r.VERSION)
        self.assertEqual(tag, 'v' + version.replace(':', '_'))

    def test_version_rejects_expressions_and_unapproved_revision(self):
        for text in ["version: `6.2.0:5`", "version: '6.2.0:../6'", "version: '6.2.0:5', version: '6.2.0:5'"]:
            with self.subTest(text=text), tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp)
                (root / 'startos/versions').mkdir(parents=True)
                (root / 'startos/versions/current.ts').write_text(text)
                with self.assertRaises(ValueError):
                    self.r.metadata(root)

    def test_only_exact_master_sha_allowed(self):
        env = {'GITHUB_REF': 'refs/heads/master', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_SHA': 'a' * 40}
        self.r.context(env)
        for key, value in [('GITHUB_REF', 'refs/heads/other'), ('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_SHA', 'a' * 40 + '-modified')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.r.context(dict(env, **{key: value}))

    def test_existing_tag_or_release_and_api_errors_fail_closed(self):
        absent = self.r.ApiError(404)
        for answers in [[{}], [absent, {}], [self.r.ApiError(403)], [self.r.ApiError(500)]]:
            with self.subTest(answers=answers), patch.object(self.r, 'api', side_effect=answers):
                with self.assertRaises((ValueError, self.r.ApiError)):
                    self.r.require_absent('owner/repo', 'v6.2.0_5')
        with patch.object(self.r, 'api', side_effect=[absent, absent]):
            self.r.require_absent('owner/repo', 'v6.2.0_5')

    def test_manifest_sha_version_and_all_architectures(self):
        m = {'id': 'listmonk', 'version': self.r.VERSION, 'gitHash': 'a' * 40,
             'images': {name: {'arch': ['x86_64']} for name in ['listmonk', 'mcp', 'postgres']},
             'hardwareRequirements': {'arch': ['x86_64']}}
        self.r.check_manifest(m, 'x86_64', 'a' * 40)
        for key, value in [('id', 'other'), ('version', '6.2.0:4'), ('gitHash', 'b' * 40), ('hardwareRequirements', {'arch': ['aarch64']}), ('images', {'listmonk': {'arch': ['aarch64']}})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.r.check_manifest(dict(copy.deepcopy(m), **{key: value}), 'x86_64', 'a' * 40)

    def test_exact_two_artifacts_bound_to_sha(self):
        data = [{'name': f'listmonk_{a}.s9pk', 'expired': False, 'workflow_run': {'head_sha': 'a' * 40}, 'digest': 'sha256:' + 'b' * 64} for a in ['aarch64', 'x86_64']]
        self.r.check_artifacts(data, 'a' * 40)
        for bad in [data[:1], data + data[:1], data + [{'name': 'extra'}], [dict(data[0], expired=True), data[1]], [dict(data[0], digest=None), data[1]]]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.r.check_artifacts(bad, 'a' * 40)
        with self.assertRaises(ValueError):
            self.r.check_artifacts(data, 'c' * 40)

    def test_zip_requires_matching_digest_and_exact_single_member(self):
        import hashlib
        import zipfile
        with tempfile.TemporaryDirectory() as tmp:
            directory = pathlib.Path(tmp)
            archive = directory / 'artifact.zip'
            for member in ['listmonk_x86_64.s9pk', '../escape', 'extra']:
                with self.subTest(member=member):
                    with zipfile.ZipFile(archive, 'w') as z:
                        z.writestr(member, b'unit-test-only package fixture')
                    artifact = {'name': 'listmonk_x86_64.s9pk', 'digest': 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()}
                    if member == artifact['name']:
                        self.r.extract_artifact(archive, artifact, directory)
                        self.assertEqual((directory / member).read_bytes(), b'unit-test-only package fixture')
                    else:
                        with self.assertRaises(ValueError):
                            self.r.extract_artifact(archive, artifact, directory)
                    with self.assertRaises(ValueError):
                        self.r.extract_artifact(archive, dict(artifact, digest='sha256:' + '0' * 64), directory)

    def test_exact_build_engine_log_guard(self):
        valid = 'Server Version: 29.9.2\nstart-cli: start-cli 2.4.2\n'
        self.r.check_build_log(valid)
        for invalid in [valid.replace('29.9.2', '29.9.3'), valid.replace('29.9.2', '29.9.2-beta'), valid.replace('2.4.2', '2.4.3'), valid.replace('2.4.2', '2.4.20'), '']:
            with self.assertRaises(ValueError):
                self.r.check_build_log(invalid)

    def test_legacy_transport_removed(self):
        source = (ROOT / 'scripts/github-release.py').read_text()
        self.assertNotIn('/logs', source)
        self.assertNotIn('/artifacts?', source)

    def test_release_asset_readback_requires_exact_names_bytes_and_digests(self):
        with tempfile.TemporaryDirectory() as tmp:
            asset = pathlib.Path(tmp) / 'SHA256SUMS'
            asset.write_text('test fixture only')
            valid = {'assets': [{'name': asset.name, 'size': asset.stat().st_size, 'digest': 'sha256:' + self.r.sha256(asset)}]}
            self.r.check_release_assets(valid, [asset])
            for bad in [{'assets': []}, {'assets': [dict(valid['assets'][0], size=1)]}, {'assets': [dict(valid['assets'][0], digest='sha256:' + 'a' * 64)]}]:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    self.r.check_release_assets(bad, [asset])

    def test_workflow_uses_native_direct_release_assets(self):
        build = (ROOT / '.github/workflows/build.yml').read_text()
        release = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertIn('workflow_call:', build)
        self.assertIn('python3 scripts/test-release.py', build)
        self.assertIn('uses: ./.github/workflows/build.yml', release)
        self.assertIn('needs: [preflight, native]', release)
        self.assertIn('direct-release.py native', release)
        self.assertIn("version: '29.9.2'", release)
        self.assertIn("github.ref == 'refs/heads/master'", release)
        self.assertIn('cancel-in-progress: false', release)
        for prohibited in ['secrets: inherit', 'DEV_KEY:', 'registry:', 'S3', 'tagAndRelease', '--clobber', 'upload-artifact', 'download-artifact', 'start-technologies/.github/workflows/build']:
            self.assertNotIn(prohibited, release + build)


if __name__ == '__main__':
    unittest.main(verbosity=2)
