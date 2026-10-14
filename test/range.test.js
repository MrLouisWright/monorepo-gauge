import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfies, minVersion } from '../src/index.js';

test('satisfies: npm range semantics', () => {
  const cases = [['1.2.3', '^1.0.0', true], ['2.0.0', '^1.0.0', false], ['0.2.5', '^0.2.0', true], ['0.3.0', '^0.2.0', false], ['0.0.4', '^0.0.3', false], ['1.2.9', '~1.2.0', true], ['1.3.0', '~1.2.0', false], ['1.5.0', '1.x', true], ['2.0.0', '1 - 2', true], ['3.0.0', '1 - 2', false], ['1.0.0', '>=1.0.0 <2', true], ['2.1.0', '<2 || >=2.1', true], ['18.20.0', '>=18', true], ['16.0.0', '>=18', false], ['1.0.0-rc.1', '^1.0.0', false], ['1.0.0-rc.2', '^1.0.0-rc.1', true], ['5.0.0', '*', true], ['1.2.3', '1.2.3', true], ['1.2.4', '1.2.3', false], ['20.1.0', '^18 || ^20 || >=22', true], ['21.0.0', '^18 || ^20 || >=22', false], ['1.2.0', '> 1.1', true], ['1.1.5', '<=1.1', true], ['1.2.0', '<=1.1', false], ['2.0.0', '', true]];
  for (const [v, r, want] of cases) assert.equal(satisfies(v, r), want, `${v} ${r}`);
  assert.equal(satisfies('1.0.0', 'not a range'), false);
});
test('minVersion', () => {
  assert.deepEqual(minVersion('^18.2 || >=20'), { major: 18, minor: 2, patch: 0, pre: [] });
  assert.equal(minVersion('~4.17.21').patch, 21);
  assert.equal(minVersion('*').major, 0);
});
