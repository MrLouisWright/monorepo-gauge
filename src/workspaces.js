import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { globToRe } from './glob.js';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache']);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Read the "packages:" list from pnpm-workspace.yaml (block or flow style). */
export function pnpmPatterns(text) {
  const out = []; let inList = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    const flow = /^packages:\s*\[(.*)\]\s*$/.exec(line);
    if (flow) { out.push(...flow[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)); continue; }
    if (/^packages:\s*$/.test(line)) { inList = true; continue; }
    if (inList) { const m = /^\s+-\s*(.+?)\s*$/.exec(line); if (m) out.push(m[1].replace(/^['"]|['"]$/g, '')); else if (/^\S/.test(line)) inList = false; }
  }
  return out;
}

/** Find workspace patterns and their source. */
export function workspaceConfig(root) {
  const res = { patterns: [], sources: [], manager: 'npm', rootPkg: null, lerna: null };
  const pj = join(root, 'package.json');
  if (existsSync(pj)) { res.rootPkg = readJson(pj); const w = res.rootPkg.workspaces; const list = Array.isArray(w) ? w : w?.packages; if (list?.length) { res.patterns.push(...list); res.sources.push('package.json'); } }
  if (existsSync(join(root, 'pnpm-workspace.yaml'))) { res.manager = 'pnpm'; const p = pnpmPatterns(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')); if (p.length) { res.patterns.push(...p); res.sources.push('pnpm-workspace.yaml'); } }
  else if (existsSync(join(root, 'yarn.lock'))) res.manager = existsSync(join(root, '.yarnrc.yml')) ? 'yarn-berry' : 'yarn';
  if (existsSync(join(root, 'lerna.json'))) { res.lerna = readJson(join(root, 'lerna.json')); if (res.lerna.packages?.length && !res.patterns.length) { res.patterns.push(...res.lerna.packages); res.sources.push('lerna.json'); } }
  if (res.rootPkg?.packageManager) { const m = /^(npm|pnpm|yarn|bun)@(\d+)/.exec(res.rootPkg.packageManager); if (m) res.manager = m[1] === 'yarn' ? (+m[2] >= 2 ? 'yarn-berry' : 'yarn') : m[1]; }
  res.patterns = [...new Set(res.patterns)];
  return res;
}

function dirs(root, base, depth, out) {
  if (depth > 6) return out;
  let ents; try { ents = readdirSync(join(root, base), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) { const r = base ? `${base}/${e.name}` : e.name; out.push(r); dirs(root, r, depth + 1, out); }
  return out;
}

/** Expand patterns into package directories (relative, sorted). Returns { packages, empty: [patterns matching nothing] } */
export function expandWorkspaces(root, patterns) {
  const inc = patterns.filter((p) => !p.startsWith('!')).map((p) => p.replace(/^\.\//, '').replace(/\/$/, ''));
  const exc = patterns.filter((p) => p.startsWith('!')).map((p) => globToRe(p.slice(1).replace(/^\.\//, '').replace(/\/$/, '')));
  const all = dirs(root, '', 0, []);
  const found = new Set(); const empty = [];
  for (const p of inc) {
    const re = globToRe(p); let n = 0;
    for (const d of all) if (re.test(d) && existsSync(join(root, d, 'package.json')) && !exc.some((x) => x.test(d))) { found.add(d); n++; }
    if (!n) empty.push(p);
  }
  return { packages: [...found].sort(), empty };
}

export function loadWorkspace(root) {
  const cfg = workspaceConfig(root);
  const { packages, empty } = expandWorkspaces(root, cfg.patterns);
  const pkgs = [];
  for (const d of packages) { const file = `${d}/package.json`; let pkg; try { pkg = readJson(join(root, file)); } catch (e) { pkgs.push({ dir: d, file, error: e.message, pkg: {} }); continue; } pkgs.push({ dir: d, file, pkg }); }
  return { ...cfg, packages: pkgs, empty, root: relative(process.cwd(), root) || '.' };
}
