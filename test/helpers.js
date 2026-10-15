import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const BIN = fileURLToPath(new URL('../bin/monorepo-gauge.js', import.meta.url));
export const FX = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
export const tmp = () => mkdtempSync(join(tmpdir(), 'mg-'));
export function repo(files) { const d = tmp(); for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), typeof c === 'string' ? c : JSON.stringify(c)); if (p.endsWith('package.json') && !(p.replace('package.json', 'index.js') in files)) writeFileSync(join(d, p.replace('package.json', 'index.js')), ''); } return d; }
export function run(args) { const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }); return { code: r.status, out: r.stdout, err: r.stderr }; }
export const pub = (name, version, extra = {}) => ({ name, version, description: name, license: 'MIT', keywords: ['x'], homepage: 'https://example.com', repository: { type: 'git', url: 'git+https://github.com/x/y.git', directory: extra.dir }, ...extra });
