import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, findCycles, pnpmPatterns, expandWorkspaces } from '../src/index.js';
import { FX, repo, pub } from './helpers.js';

const now = new Date('2026-10-14T00:00:00Z');
const by = (r) => { const o = {}; for (const f of r.findings) (o[f.rule] ||= []).push(f.subject); for (const k in o) o[k].sort(); return o; };

test('clean monorepo has no findings', () => {
  const r = check(FX('clean'), { now });
  assert.deepEqual(r.findings, []);
  assert.equal(r.info.manager, 'npm'); assert.deepEqual(r.info.packages.map((p) => p.name), ['@clean/cli', '@clean/core']);
  assert.deepEqual(r.info.packages[0].internalDeps, ['@clean/core']);
});
test('messy pnpm monorepo: every rule', () => {
  const r = check(FX('messy'), { now });
  assert.equal(r.info.manager, 'pnpm');
  assert.ok(!r.info.packages.some((p) => p.name === 'old'), '!packages/old excluded');
  assert.deepEqual(by(r), {
    'duplicate-package-name': ['dup'],
    'private-dependency': ['a>priv'],
    'circular-dependency': ['a>b>c'],
    'internal-range-mismatch': ['b>c'],
    'package-field': ['c:description-missing:description', 'c:homepage-missing:homepage', 'c:keywords-missing:keywords', 'c:repository-missing:repository'],
    'workspace-protocol-inconsistent': ['a>priv', 'priv>a'],
    'dependency-major-drift': ['react'],
    'workspace-empty': ['apps/*'],
    'root-not-private': [undefined],
    'repository-directory': ['a', 'b'],
    'circular-dev-dependency': ['a>priv'],
    'dependency-range-drift': ['typescript'],
    'field-drift': ['b:license'],
    'workspace-protocol': ['b>c'],
  });
  const mm = r.findings.find((f) => f.rule === 'internal-range-mismatch');
  assert.match(mm.message, /"c": "\^2\.0\.0" does not match the local c@1\.0\.0/); assert.match(mm.fix, /\^1\.0\.0/);
});
test('fixed versioning via lerna.json or option', () => {
  const d = repo({ 'package.json': { private: true, workspaces: ['packages/*'] }, 'lerna.json': { version: '3.0.0' }, 'packages/a/package.json': pub('a', '3.0.0', { dir: 'packages/a' }), 'packages/b/package.json': pub('b', '2.9.0', { dir: 'packages/b' }) });
  assert.deepEqual(by(check(d, { now })), { 'version-drift': ['b'] });
  assert.deepEqual(by(check(d, { now, versioning: 'independent' })), {});
  const d2 = repo({ 'package.json': { private: true, workspaces: { packages: ['libs/**'] } }, 'libs/x/a/package.json': pub('a', '1.0.0', { dir: 'libs/x/a' }), 'libs/b/package.json': pub('b', '1.1.0', { dir: 'libs/b' }) });
  assert.deepEqual(by(check(d2, { now, versioning: 'fixed' })), { 'version-drift': ['a'] });
});
test('required fields configurable; private packages need only a name', () => {
  const d = repo({ 'package.json': { private: true, workspaces: ['p/*'] }, 'p/a/package.json': { name: 'a', private: true }, 'p/b/package.json': pub('b', '1.0.0', { dir: 'p/b' }) });
  assert.deepEqual(by(check(d, { now })), {});
  assert.deepEqual(by(check(d, { now, requiredFields: ['name', 'engines.node'] })), { 'package-field': ['b:required-field:engines.node'] });
});
test('ignorePackages and ignoreDeps', () => {
  const r = check(FX('messy'), { now, ignorePackages: ['dup*', 'packages/priv'], ignoreDeps: ['react', 'typescript'] });
  const rules = new Set(r.findings.map((f) => f.rule));
  assert.ok(!rules.has('duplicate-package-name')); assert.ok(!rules.has('dependency-major-drift')); assert.ok(!rules.has('dependency-range-drift'));
});
test('invalid package.json and no workspaces', () => {
  const d = repo({ 'package.json': { private: true, workspaces: ['p/*'] }, 'p/a/package.json': '{ nope' });
  assert.deepEqual(by(check(d, { now })), { 'invalid-package-json': [undefined] });
  assert.throws(() => check(repo({ 'package.json': { name: 'solo' } }), { now }), /No workspaces/);
});
test('findCycles dedupes rotations and finds multiple cycles', () => {
  const e = new Map([['a', new Set(['b'])], ['b', new Set(['a', 'c'])], ['c', new Set(['c2'])], ['c2', new Set(['c'])]]);
  assert.deepEqual(findCycles(e), [['a', 'b', 'a'], ['c', 'c2', 'c']]);
});
test('pnpm-workspace.yaml parsing and glob expansion', () => {
  assert.deepEqual(pnpmPatterns("packages:\n  - 'apps/*'\n  - packages/** # all\n  - '!**/test/**'\ncatalog:\n  react: ^18\n"), ['apps/*', 'packages/**', '!**/test/**']);
  assert.deepEqual(pnpmPatterns('packages: [a/*, "b/*"]\n'), ['a/*', 'b/*']);
  const d = repo({ 'x/one/package.json': {}, 'x/deep/two/package.json': {}, 'x/test/three/package.json': {}, 'x/nopkg/readme.md': '' });
  assert.deepEqual(expandWorkspaces(d, ['x/**', '!**/test/**']).packages, ['x/deep/two', 'x/one']);
});
test('allowlist with expiry', () => {
  const r = check(FX('messy'), { now }, { allowlist: [{ rule: 'dependency-major-drift', subject: 'react', reason: 'legacy app', expires: '2027-01-01' }, { rule: 'field-drift', reason: 'b is ISC by design', expires: '2026-01-01' }] });
  assert.ok(!r.findings.some((f) => f.rule === 'dependency-major-drift'));
  assert.ok(r.findings.some((f) => f.rule === 'allowlist-expired'));
});
