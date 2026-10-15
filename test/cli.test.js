import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FX, run, tmp, repo } from './helpers.js';

test('exit codes', () => {
  assert.equal(run([FX('clean'), '--fail-on', 'info']).code, 0);
  assert.equal(run([FX('messy')]).code, 1);
  assert.equal(run([FX('messy'), '--fail-on', 'none']).code, 0);
});
test('formats and files', () => {
  const o = tmp();
  run([FX('messy'), '--json', join(o, 'r.json'), '--sarif', join(o, 'r.sarif'), '--markdown', join(o, 'r.md')]);
  assert.equal(JSON.parse(readFileSync(join(o, 'r.json'), 'utf8')).counts.critical, 1);
  const s = JSON.parse(readFileSync(join(o, 'r.sarif'), 'utf8')); assert.ok(s.runs[0].results.some((x) => x.ruleId === 'circular-dependency' && x.level === 'error'));
  assert.match(readFileSync(join(o, 'r.md'), 'utf8'), /circular dependency: a → b → c → a/);
  assert.match(run([FX('messy'), '-f', 'markdown']).out, /monorepo-gauge/);
});
test('flags and config', () => {
  assert.match(run([FX('messy'), '--versioning', 'fixed', '-f', 'json']).out, /version-drift/);
  assert.match(run([FX('clean'), '--require', 'name,funding', '--fail-on', 'medium']).out, /funding/);
  const d = repo({ 'package.json': { private: true, workspaces: ['p/*'], monorepoGauge: { requiredFields: ['name', 'author'] } }, 'p/a/package.json': { name: 'a', version: '1.0.0' } });
  assert.match(run([d, '--fail-on', 'medium']).out, /required field "author" is missing/);
  writeFileSync(join(d, '.monorepo-gauge.json'), JSON.stringify({ severity: { 'package-field': 'nope' } }));
  assert.equal(run([d]).code, 2);
});
test('usage errors', () => {
  assert.equal(run([tmp()]).code, 2);
  assert.equal(run([FX('clean'), '--versioning', 'sometimes']).code, 2);
  assert.equal(run(['--nope']).code, 2);
});
test('--help, --version, --list-rules', () => {
  assert.match(run(['--help']).out, /--versioning/);
  assert.match(run(['--version']).out, /^1\./);
  assert.match(run(['--list-rules']).out, /circular-dependency/);
});
