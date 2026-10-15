import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, applyFixes, analyze } from '../src/index.js';
import { repo, pub, run } from './helpers.js';

const now = new Date('2026-10-14T00:00:00Z');
const by = (r) => { const o = {}; for (const f of r.findings) (o[f.rule] ||= []).push(f.subject); for (const k in o) o[k].sort(); return o; };
const read = (d, f) => JSON.parse(readFileSync(join(d, f), 'utf8'));

test('per-package field checks are delegated to pkg-field-gauge', () => {
  const d = repo({ 'package.json': { private: true, workspaces: ['p/*'] }, 'p/a/package.json': pub('a', '1.0.0', { dir: 'p/a', main: 'dist/a.js', license: 'MIT OR' }), 'p/b/package.json': { name: 'b', private: true, main: 'gone.js' } });
  const r = check(d, { now });
  const subj = by(r)['package-field'];
  assert.ok(subj.includes('a:entry-missing:main:dist/a.js'), subj.join());
  assert.ok(subj.includes('a:license-invalid:license'), subj.join());
  assert.ok(subj.includes('b:entry-missing:main:gone.js'), 'private packages still get entry checks');
  assert.ok(!subj.some((s) => s.startsWith('b:description')), 'publishing-only rules skipped for private');
  assert.equal(r.findings.find((f) => f.subject === 'a:entry-missing:main:dist/a.js').severity, 'high');
  assert.deepEqual(by(check(d, { now, packageFields: false })), {});
  assert.ok(!by(check(d, { now }, { packageFields: { skip: ['entry-missing'] } }))['package-field'].some((s) => s.includes('entry-missing')));
});

test('workspace: protocol consistency and unsupported managers', () => {
  const mixed = repo({ 'package.json': { private: true }, 'pnpm-workspace.yaml': 'packages:\n  - p/*\n', 'p/a/package.json': pub('a', '1.0.0', { dir: 'p/a' }), 'p/b/package.json': pub('b', '1.0.0', { dir: 'p/b', dependencies: { a: 'workspace:^' } }), 'p/c/package.json': pub('c', '1.0.0', { dir: 'p/c', dependencies: { a: 'workspace:^', b: 'workspace:*' } }) });
  assert.deepEqual(by(check(mixed, { now })), { 'workspace-protocol-inconsistent': ['c>b'] });
  assert.deepEqual(by(check(mixed, { now, workspaceProtocolStyle: '*' })), { 'workspace-protocol-inconsistent': ['b>a', 'c>a'] });
  const npm = repo({ 'package.json': { private: true, workspaces: ['p/*'] }, 'p/a/package.json': pub('a', '1.2.0', { dir: 'p/a' }), 'p/b/package.json': pub('b', '1.0.0', { dir: 'p/b', dependencies: { a: 'workspace:^' } }) });
  const r = check(npm, { now });
  assert.deepEqual(by(r), { 'workspace-protocol-unsupported': ['b>a'] });
  assert.match(r.findings[0].message, /EUNSUPPORTEDPROTOCOL/);
  check(npm, { now, fix: true });
  assert.equal(read(npm, 'p/b/package.json').dependencies.a, '^1.2.0');
});

test('versionGroups: pin, sameRange, banned, ignored', () => {
  const d = repo({ 'package.json': { private: true, workspaces: ['p/*'] },
    'p/a/package.json': pub('a', '1.0.0', { dir: 'p/a', dependencies: { react: '^18.2.0', lodash: '^4.17.0', moment: '^2.0.0', zod: '^3.0.0' } }),
    'p/b/package.json': pub('b', '1.0.0', { dir: 'p/b', dependencies: { react: '18.2.0', lodash: '~4.17.21', zod: '^3.1.0' } }),
    'p/legacy/package.json': pub('legacy', '1.0.0', { dir: 'p/legacy', dependencies: { react: '^16.0.0' } }) });
  assert.deepEqual(by(check(d, { now })), { 'dependency-major-drift': ['react'], 'dependency-range-drift': ['lodash', 'zod'] });
  const versionGroups = [
    { label: 'legacy', packages: ['legacy'], policy: 'ignored' },
    { dependencies: ['react'], policy: 'pin', pinVersion: '18.3.1' },
    { dependencies: ['moment'], policy: 'banned', reason: 'Use date-fns.' },
    { dependencies: ['lodash'], policy: 'sameRange' },
  ];
  const r = check(d, { now }, { versionGroups });
  assert.deepEqual(by(r), { 'version-group-mismatch': ['a>react', 'b>react', 'lodash'], 'banned-dependency': ['a>moment'], 'dependency-range-drift': ['zod'] });
  assert.equal(r.findings.find((f) => f.rule === 'banned-dependency').fix, 'Use date-fns.');
  check(d, { now, fix: true }, { versionGroups });
  assert.equal(read(d, 'p/a/package.json').dependencies.react, '18.3.1');
  assert.equal(read(d, 'p/b/package.json').dependencies.zod, '^3.1.0');
  assert.equal(read(d, 'p/a/package.json').dependencies.zod, '^3.1.0');
  assert.equal(read(d, 'p/legacy/package.json').dependencies.react, '^16.0.0', 'ignored group untouched');
});

test('--fix: internal ranges, version drift, repository.directory, keeps indentation', () => {
  const files = { 'package.json': { private: true }, 'lerna.json': { version: '2.0.0' }, 'pnpm-workspace.yaml': 'packages: [p/*]\n',
    'p/a/package.json': JSON.stringify(pub('a', '2.0.0', { dir: 'p/a' }), null, 4) + '\n',
    'p/b/package.json': pub('b', '1.9.0', { dir: 'wrong', dependencies: { a: '^1.0.0', react: '^17.0.0' } }),
    'p/c/package.json': pub('c', '2.0.0', { dir: 'p/c', dependencies: { b: 'workspace:^', a: 'workspace:~', react: '^18.0.0' } }) };
  const d = repo(files);
  const before = by(check(d, { now }));
  assert.deepEqual(Object.keys(before).sort(), ['dependency-major-drift', 'internal-range-mismatch', 'repository-directory', 'version-drift', 'workspace-protocol', 'workspace-protocol-inconsistent']);
  const dry = check(d, { now, fix: true, fixDryRun: true });
  assert.ok(dry.fixed.length >= 4); assert.equal(read(d, 'p/b/package.json').version, '1.9.0');
  const r = check(d, { now, fix: true });
  const b = read(d, 'p/b/package.json'); const c = read(d, 'p/c/package.json');
  assert.equal(b.version, '2.0.0'); assert.equal(b.dependencies.a, 'workspace:^'); assert.equal(b.repository.directory, 'p/b');
  assert.equal(c.dependencies.a, 'workspace:^');
  assert.equal(b.dependencies.react, '^17.0.0', 'major drift needs fixMajors');
  assert.deepEqual(by(r), { 'dependency-major-drift': ['react'] });
  assert.ok(r.fixed.some((x) => x.rule === 'version-drift' && x.from === '1.9.0' && x.to === '2.0.0'));
  check(d, { now, fix: true, fixMajors: true });
  assert.equal(read(d, 'p/b/package.json').dependencies.react, '^18.0.0');
  assert.ok(readFileSync(join(d, 'p/a/package.json'), 'utf8').startsWith('{\n    "name"'));
  assert.deepEqual(applyFixes(d, analyze(d).findings), []);
});

test('CLI --fix and --dry-run', () => {
  const d = repo({ 'package.json': { private: true, workspaces: ['p/*'] }, 'p/a/package.json': pub('a', '1.1.0', { dir: 'p/a' }), 'p/b/package.json': pub('b', '1.0.0', { dir: 'p/b', dependencies: { a: '^2.0.0' } }) });
  const dry = run([d, '--fix', '--dry-run']);
  assert.match(dry.out + dry.err, /would fix/i); assert.equal(read(d, 'p/b/package.json').dependencies.a, '^2.0.0');
  const r = run([d, '--fix']);
  assert.equal(r.code, 0, r.out + r.err); assert.match(r.out + r.err, /fixed 1/i);
  assert.equal(read(d, 'p/b/package.json').dependencies.a, '^1.1.0');
});

test('invalid versionGroups are usage errors', () => {
  const d = repo({ 'package.json': { private: true, workspaces: ['p/*'] }, 'p/a/package.json': pub('a', '1.0.0', { dir: 'p/a' }) });
  assert.throws(() => check(d, { now }, { versionGroups: [{ policy: 'pin' }] }), /pinVersion/);
  assert.throws(() => check(d, { now }, { versionGroups: [{ policy: 'yolo' }] }), /policy/);
});
