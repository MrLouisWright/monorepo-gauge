import { resolve, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkPackage } from 'pkg-field-gauge';
import { loadWorkspace, pnpmPatterns, expandWorkspaces, workspaceConfig } from './workspaces.js';
import { satisfies, parseVersion, minVersion, validRange } from './range.js';
import { globToRe } from './glob.js';
import { buildReport, UsageError } from './core.js';

export { loadWorkspace, pnpmPatterns, expandWorkspaces, workspaceConfig, satisfies, minVersion };
export * from './core.js';

export const RULES = {
  'duplicate-package-name': { severity: 'critical', title: 'Two workspaces have the same package name' },
  'circular-dependency': { severity: 'high', title: 'Internal packages depend on each other in a cycle' },
  'internal-range-mismatch': { severity: 'high', title: 'Internal dependency range does not match the local package version' },
  'private-dependency': { severity: 'high', title: 'Publishable package depends on a private workspace package' },
  'invalid-package-json': { severity: 'high', title: 'Workspace package.json cannot be parsed' },
  'dependency-major-drift': { severity: 'medium', title: 'Packages require different major versions of the same dependency' },
  'root-not-private': { severity: 'medium', title: 'Workspace root is not marked "private": true' },
  'package-field': { severity: 'medium', title: 'pkg-field-gauge finding for one workspace package (severity comes from the underlying rule)' },
  'banned-dependency': { severity: 'high', title: 'Dependency is banned by a versionGroups policy' },
  'workspace-protocol-unsupported': { severity: 'high', title: 'workspace: protocol used with a package manager that does not support it (npm, yarn classic)' },
  'version-group-mismatch': { severity: 'medium', title: 'Dependency range breaks its versionGroups policy (pin / sameRange)' },
  'workspace-protocol-inconsistent': { severity: 'low', title: 'Internal dependencies mix workspace:^, workspace:~, workspace:* or explicit workspace: ranges' },
  'workspace-empty': { severity: 'medium', title: 'Workspace pattern matches no packages' },
  'dependency-range-drift': { severity: 'low', title: 'Packages use different ranges for the same dependency (same major)' },
  'version-drift': { severity: 'low', title: 'Package versions differ under fixed/locked versioning' },
  'field-drift': { severity: 'low', title: 'license / engines / type differs from the rest of the monorepo' },
  'repository-directory': { severity: 'low', title: 'repository.directory is missing or wrong' },
  'circular-dev-dependency': { severity: 'low', title: 'Cycle through devDependencies' },
  'workspace-protocol': { severity: 'info', title: 'Internal dependency does not use the workspace: protocol' },
};

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const PROD_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
/** pkg-field-gauge rules skipped by default (pack/git checks are slow or repo-level). */
/** Fields pkg-field-gauge already checks with its own rules (name → invalid-name, etc.), so they are not passed as extra required fields. */
const FIELD_COVERED = ['name', 'version', 'description', 'license', 'repository', 'keywords', 'homepage'];
export const DEFAULT_FIELD_SKIP = ['not-in-tarball', 'repository-mismatch'];
/** Publishing-only rules skipped for private workspaces. */
export const PRIVATE_FIELD_SKIP = ['description-missing', 'keywords-missing', 'repository-missing', 'license-missing', 'license-invalid', 'homepage-missing', 'files-entry-unmatched', 'not-in-files', 'invalid-version'];
const STYLE_ORDER = ['^', '~', '*', 'range'];
const protocolStyle = (r) => (r === '' || r === '*' ? '*' : r === '^' ? '^' : r === '~' ? '~' : 'range');
export const DEFAULT_REQUIRED = { public: ['name', 'version', 'description', 'license', 'repository'], private: ['name'] };

const pathOf = (cycle) => cycle.join(' → ');

/** Find elementary cycles (deduplicated by rotation) with DFS; edges: Map name -> Set(name). */
export function findCycles(edges, limit = 50) {
  const cycles = []; const seen = new Set();
  const nodes = [...edges.keys()].sort();
  const stack = []; const onStack = new Set(); const done = new Set();
  function dfs(n) {
    if (cycles.length >= limit) return;
    stack.push(n); onStack.add(n);
    for (const m of [...(edges.get(n) || [])].sort()) {
      if (onStack.has(m)) {
        const c = stack.slice(stack.indexOf(m));
        const min = c.indexOf([...c].sort()[0]); const rot = [...c.slice(min), ...c.slice(0, min)];
        const key = rot.join('>'); if (!seen.has(key)) { seen.add(key); cycles.push([...rot, rot[0]]); }
      } else if (!done.has(m)) dfs(m);
    }
    stack.pop(); onStack.delete(n); done.add(n);
  }
  for (const n of nodes) if (!done.has(n)) dfs(n);
  return cycles;
}

export function analyze(root, opts = {}) {
  const ws = loadWorkspace(root);
  if (!ws.patterns.length) throw new UsageError(`No workspaces found in ${root} (package.json "workspaces", pnpm-workspace.yaml or lerna.json)`);
  const findings = [];
  const add = (rule, message, fix, extra = {}) => findings.push({ rule, severity: RULES[rule].severity, message, fix, ...extra });
  const ignore = (opts.ignorePackages || []).map((g) => globToRe(g));
  const pkgs = ws.packages.filter((p) => !ignore.some((re) => re.test(p.pkg.name || '') || re.test(p.dir)));
  const rootFile = ws.sources[0] || 'package.json';
  for (const e of ws.empty) add('workspace-empty', `workspace pattern "${e}" matches no package`, 'Remove the pattern or add the package.', { file: rootFile, subject: e });
  if (ws.rootPkg && ws.rootPkg.private !== true) add('root-not-private', 'root package.json is not "private": true, so `npm publish` at the root would publish the whole monorepo', 'Add "private": true to the root package.json.', { file: 'package.json' });
  for (const p of pkgs.filter((x) => x.error)) add('invalid-package-json', `${p.file}: ${p.error}`, 'Fix the JSON syntax.', { file: p.file });
  const valid = pkgs.filter((p) => !p.error);

  // names
  const byName = new Map();
  for (const p of valid) { if (!p.pkg.name) continue; if (!byName.has(p.pkg.name)) byName.set(p.pkg.name, []); byName.get(p.pkg.name).push(p); }
  for (const [name, list] of byName) if (list.length > 1) add('duplicate-package-name', `"${name}" is the name of ${list.length} workspaces: ${list.map((x) => x.dir).join(', ')}`, 'Give each workspace a unique name.', { file: list[1].file, subject: name });
  const internal = new Map([...byName].map(([n, l]) => [n, l[0]]));

  // per-package fields: delegated to pkg-field-gauge
  const reqPub = opts.requiredFields || DEFAULT_REQUIRED.public; const reqPriv = opts.requiredFieldsPrivate || DEFAULT_REQUIRED.private;
  const pf = opts.packageFields === false ? null : (opts.packageFields || {});
  for (const p of valid) {
    if (pf) {
      const skip = [...DEFAULT_FIELD_SKIP, ...(pf.skip || []), ...(p.pkg.private ? PRIVATE_FIELD_SKIP : [])];
      let res; try { res = checkPackage(join(root, p.dir), { require: (p.pkg.private ? reqPriv : reqPub).filter((f) => !FIELD_COVERED.includes(f)), rules: pf.rules, skip, pack: pf.pack === true }); } catch (e) { res = { findings: [{ rule: 'invalid-name', severity: 'high', message: `pkg-field-gauge failed: ${e.message}` }] }; }
      for (const f of res.findings) {
        const who = p.pkg.name || p.dir;
        findings.push({ rule: 'package-field', severity: f.severity || 'medium', message: `${who}: ${f.message}`, fix: f.fix, file: p.file, subject: `${who}:${f.rule}${f.subject ? `:${f.subject}` : ''}`, fieldRule: f.rule });
      }
    }
    if (!p.pkg.private && typeof p.pkg.repository === 'object' && p.pkg.repository) {
      const d = p.pkg.repository.directory;
      if (!d) add('repository-directory', `${p.pkg.name} repository has no "directory" (npm links to the repo root)`, `Add "directory": "${p.dir}".`, { file: p.file, subject: p.pkg.name, edit: { file: p.file, path: ['repository', 'directory'], value: p.dir } });
      else if (d.replace(/^\.\//, '').replace(/\/$/, '') !== p.dir) add('repository-directory', `${p.pkg.name} repository.directory is "${d}" but the package lives in "${p.dir}"`, `Set "directory": "${p.dir}".`, { file: p.file, subject: p.pkg.name, edit: { file: p.file, path: ['repository', 'directory'], value: p.dir } });
    }
  }

  // internal deps
  const prodEdges = new Map(); const allEdges = new Map();
  const usesProtocol = ws.manager === 'pnpm' || ws.manager === 'yarn-berry';
  const wsUses = [];
  for (const p of valid) {
    const name = p.pkg.name || p.dir; prodEdges.set(name, new Set()); allEdges.set(name, new Set());
    for (const field of DEP_FIELDS) for (const [dep, range0] of Object.entries(p.pkg[field] || {})) {
      const target = internal.get(dep); if (!target || dep === name) continue;
      allEdges.get(name).add(dep); if (PROD_FIELDS.includes(field)) prodEdges.get(name).add(dep);
      const range = String(range0);
      if (/^(file|link|portal|npm|git|github|https?):/.test(range) || /^[./~]/.test(range) || !validRange(range) && !range.startsWith('workspace:')) continue;
      let r = range; const tv = target.pkg.version; const ed = (value) => ({ file: p.file, path: [field, dep], value });
      if (r.startsWith('workspace:')) {
        r = r.slice(10); wsUses.push({ name, dep, field, p, style: protocolStyle(r), range, tv });
        if (['*', '^', '~', ''].includes(r)) r = null;
      } else if (usesProtocol && opts.workspaceProtocol !== false && range !== 'latest' && range !== '*') add('workspace-protocol', `${name} → ${dep} uses "${range}" instead of the workspace: protocol`, `Use "workspace:^" so ${ws.manager} always links the local package.`, { file: p.file, subject: `${name}>${dep}`, edit: ed('workspace:^') });
      if (r && tv && validRange(r) && !satisfies(tv, r)) add('internal-range-mismatch', `${name} ${field}: "${dep}": "${range}" does not match the local ${dep}@${tv}`, `Use "^${tv}"${usesProtocol ? ' or "workspace:^"' : ''}; otherwise the package manager installs ${dep} from the registry instead of linking it.`, { file: p.file, subject: `${name}>${dep}`, edit: ed(range.startsWith('workspace:') ? 'workspace:^' : usesProtocol && opts.workspaceProtocol !== false ? 'workspace:^' : `^${tv}`) });
      if (field !== 'devDependencies' && !p.pkg.private && target.pkg.private) add('private-dependency', `${name} (published) has ${dep} in ${field}, but ${dep} is private and can never be installed by users`, `Publish ${dep}, bundle it, or move it to devDependencies.`, { file: p.file, subject: `${name}>${dep}` });
    }
  }
  // workspace: protocol consistency
  if (wsUses.length && !usesProtocol && ws.manager !== 'bun') {
    for (const u of wsUses) add('workspace-protocol-unsupported', `${u.name} → ${u.dep} uses "${u.range}" but ${ws.manager} does not understand the workspace: protocol (install fails with EUNSUPPORTEDPROTOCOL)`, `Use "^${u.tv}" or switch to pnpm/yarn berry.`, { file: u.p.file, subject: `${u.name}>${u.dep}`, edit: u.tv ? { file: u.p.file, path: [u.field, u.dep], value: `^${u.tv}` } : undefined });
  } else if (wsUses.length) {
    const counts = new Map(); for (const u of wsUses) counts.set(u.style, (counts.get(u.style) || 0) + 1);
    const want = opts.workspaceProtocolStyle || (counts.size > 1 ? [...counts].sort((a, b) => b[1] - a[1] || STYLE_ORDER.indexOf(a[0]) - STYLE_ORDER.indexOf(b[0]))[0][0] : null);
    if (want && (counts.size > 1 || !counts.has(want))) for (const u of wsUses) if (u.style !== want) {
      const value = want === 'range' ? `workspace:^${u.tv}` : `workspace:${want}`;
      add('workspace-protocol-inconsistent', `${u.name} → ${u.dep} uses "${u.range}" but the monorepo uses workspace:${want === 'range' ? '<range>' : want}`, `Use "${value}" everywhere so published ranges are predictable.`, { file: u.p.file, subject: `${u.name}>${u.dep}`, edit: { file: u.p.file, path: [u.field, u.dep], value } });
    }
  }

  for (const c of findCycles(prodEdges)) add('circular-dependency', `circular dependency: ${pathOf(c)}`, 'Break the cycle by extracting the shared code into a new package or inverting one dependency.', { file: internal.get(c[0])?.file, subject: c.slice(0, -1).join('>') });
  const prodKeys = new Set(findCycles(prodEdges).map((c) => c.slice(0, -1).join('>')));
  for (const c of findCycles(allEdges)) { const k = c.slice(0, -1).join('>'); if (!prodKeys.has(k)) add('circular-dev-dependency', `cycle through devDependencies: ${pathOf(c)}`, 'Dev cycles break topological builds/tests (e.g. turbo/nx/pnpm -r); move the shared test helper into its own package.', { file: internal.get(c[0])?.file, subject: k }); }

  // external dependency drift
  const ext = new Map();
  const rootDeps = ws.rootPkg ? DEP_FIELDS.flatMap((f) => Object.entries(ws.rootPkg[f] || {}).map(([d, r]) => ({ d, r, f, who: '(root)', file: 'package.json' }))) : [];
  for (const p of valid) for (const f of DEP_FIELDS) { if (f === 'peerDependencies' && !opts.includePeers) continue; for (const [d, r] of Object.entries(p.pkg[f] || {})) if (!internal.has(d)) rootDeps.push({ d, r: String(r), f, who: p.pkg.name || p.dir, file: p.file }); }
  for (const x of rootDeps) { if (/^(workspace|file|link|portal|npm|git|github|https?|catalog):/.test(x.r) || /\//.test(x.r) && !/^[\^~<>=\d]/.test(x.r)) continue; if (!ext.has(x.d)) ext.set(x.d, []); ext.get(x.d).push(x); }
  const ignoreDeps = (opts.ignoreDeps || []).map((g) => globToRe(g));
  const groups = (opts.versionGroups || []).map((g, i) => ({ ...g, i, depRe: (g.dependencies || ['**']).map((x) => globToRe(x)), pkgRe: (g.packages || ['**']).map((x) => globToRe(x)), types: g.dependencyTypes }));
  const groupOf = (u) => groups.find((g) => g.depRe.some((re) => re.test(u.d)) && g.pkgRe.some((re) => re.test(u.who)) && (!g.types || g.types.includes(u.f) || g.types.includes(u.f.replace(/Dependencies$/, ''))));
  const buckets = [];
  for (const [dep, uses] of [...ext].sort()) {
    if (ignoreDeps.some((re) => re.test(dep))) continue;
    const m = new Map(); for (const u of uses) { const g = groupOf(u); const k = g ? g.i : -1; if (!m.has(k)) m.set(k, { dep, g, uses: [] }); m.get(k).uses.push(u); }
    buckets.push(...m.values());
  }
  for (const { dep, g, uses } of buckets) {
    const label = g ? ` [versionGroup ${g.label || g.i}]` : '';
    if (g && (g.policy === 'ignored' || g.isIgnored)) continue;
    if (g && (g.policy === 'banned' || g.isBanned)) { for (const u of uses) add('banned-dependency', `${u.who} uses banned dependency ${dep}@${u.r} (${u.f})${label}`, g.reason || `Remove ${dep}.`, { file: u.file, subject: `${u.who}>${dep}` }); continue; }
    if (g && (g.policy === 'pin' || g.pinVersion)) { for (const u of uses) if (u.r !== g.pinVersion) add('version-group-mismatch', `${u.who} uses ${dep}@${u.r} but it is pinned to ${g.pinVersion}${label}`, `Use "${g.pinVersion}".`, { file: u.file, subject: `${u.who}>${dep}`, edit: { file: u.file, path: [u.f, dep], value: g.pinVersion } }); continue; }
    if (g && g.policy === 'sameRange') { const rs = [...new Set(uses.map((u) => u.r))]; if (rs.length > 1) add('version-group-mismatch', `${dep}: ${rs.join(' vs ')} must be the same range${label}`, 'Use one range in every package of this group.', { file: uses[0].file, subject: dep }); continue; }
    const ranges = [...new Set(uses.map((u) => u.r))]; if (ranges.length < 2) continue;
    const majors = new Set(uses.map((u) => { const v = minVersion(u.r); return v ? (v.major === 0 ? `0.${v.minor}` : String(v.major)) : '?'; }));
    const summary = ranges.map((r) => `${r} (${uses.filter((u) => u.r === r).map((u) => u.who).slice(0, 3).join(', ')}${uses.filter((u) => u.r === r).length > 3 ? ', …' : ''})`).join(' vs ');
    const newest = [...ranges].sort((a, b) => { const x = minVersion(a); const y = minVersion(b); return !x || !y ? 0 : (x.major - y.major) || (x.minor - y.minor) || (x.patch - y.patch); }).pop();
    const odd = uses.find((u) => u.r !== newest);
    const edits = uses.filter((u) => u.r !== newest).map((u) => ({ file: u.file, path: [u.f, dep], value: newest }));
    if (majors.size > 1) add('dependency-major-drift', `${dep}: ${summary}${label}`, `Align every package on one major (e.g. "${newest}"); mixed majors install duplicate copies and break singletons.`, { file: odd.file, subject: dep, edits, risky: true });
    else add('dependency-range-drift', `${dep}: ${summary}${label}`, `Use the same range everywhere (e.g. "${newest}")${ws.manager === 'pnpm' ? ', or a pnpm catalog' : ''}.`, { file: odd.file, subject: dep, edits });
  }

  // version drift (fixed mode)
  const fixed = opts.versioning === 'fixed' || (opts.versioning !== 'independent' && ws.lerna && ws.lerna.version && ws.lerna.version !== 'independent');
  if (fixed) {
    const pub = valid.filter((p) => !p.pkg.private && p.pkg.version);
    const want = ws.lerna?.version && ws.lerna.version !== 'independent' ? ws.lerna.version : [...pub.map((p) => p.pkg.version)].sort((a, b) => { const x = parseVersion(a); const y = parseVersion(b); return !x || !y ? 0 : (x.major - y.major) || (x.minor - y.minor) || (x.patch - y.patch); }).pop();
    for (const p of pub) if (p.pkg.version !== want) add('version-drift', `${p.pkg.name}@${p.pkg.version} differs from the fixed monorepo version ${want}`, `Set "version": "${want}" (or switch to independent versioning).`, { file: p.file, subject: p.pkg.name, edit: { file: p.file, path: ['version'], value: want } });
  }

  // field drift
  for (const field of opts.consistentFields || ['license', 'engines.node', 'type']) {
    const vals = valid.filter((p) => !p.pkg.private).map((p) => ({ p, v: field.split('.').reduce((o, k) => (o == null ? o : o[k]), p.pkg) })).filter((x) => x.v !== undefined);
    const counts = new Map(); for (const x of vals) counts.set(JSON.stringify(x.v), (counts.get(JSON.stringify(x.v)) || 0) + 1);
    if (counts.size < 2) continue;
    const common = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    for (const x of vals) if (JSON.stringify(x.v) !== common) add('field-drift', `${x.p.pkg.name}: ${field} is ${JSON.stringify(x.v)} but most packages use ${common}`, `Use ${common} unless the difference is intentional.`, { file: x.p.file, subject: `${x.p.pkg.name}:${field}` });
  }
  const info = { manager: ws.manager, sources: ws.sources, patterns: ws.patterns, packages: valid.map((p) => ({ name: p.pkg.name, version: p.pkg.version, dir: p.dir, private: !!p.pkg.private, internalDeps: [...(allEdges.get(p.pkg.name || p.dir) || [])] })) };
  return { info, findings };
}

/** Fixable rules and whether --fix applies them by default. Major drift needs fixMajors. */
export const FIXABLE = ['internal-range-mismatch', 'workspace-protocol', 'workspace-protocol-inconsistent', 'workspace-protocol-unsupported', 'version-drift', 'dependency-range-drift', 'dependency-major-drift', 'version-group-mismatch', 'repository-directory'];

/** Apply the edits carried by findings. Rewrites package.json files keeping their indent. Returns the list of applied changes. */
export function applyFixes(root, findings, { rules = FIXABLE, majors = false, dryRun = false } = {}) {
  const files = new Map(); const applied = [];
  for (const f of findings) {
    if (!rules.includes(f.rule) || (f.risky && !majors)) continue;
    for (const e of f.edits || (f.edit ? [f.edit] : [])) {
      if (!files.has(e.file)) { const text = readFileSync(join(root, e.file), 'utf8'); files.set(e.file, { text, json: JSON.parse(text) }); }
      const { json } = files.get(e.file); let o = json;
      for (const k of e.path.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
      const last = e.path[e.path.length - 1]; const from = o[last];
      if (from === e.value) continue;
      o[last] = e.value; applied.push({ rule: f.rule, file: e.file, path: e.path.join('.'), from, to: e.value });
    }
  }
  if (!dryRun) for (const [file, { text, json }] of files) {
    const indent = (text.match(/^[ \t]+(?=")/m) || ['  '])[0];
    writeFileSync(join(root, file), JSON.stringify(json, null, indent) + (text.endsWith('\n') ? '\n' : ''));
  }
  return applied;
}

export function check(dir, opts = {}, config = {}, configFile) {
  const merged = { requiredFields: config.requiredFields, requiredFieldsPrivate: config.requiredFieldsPrivate, versioning: config.versioning, ignorePackages: config.ignorePackages, ignoreDeps: config.ignoreDeps, includePeers: config.includePeers, consistentFields: config.consistentFields, workspaceProtocol: config.workspaceProtocol, workspaceProtocolStyle: config.workspaceProtocolStyle, versionGroups: config.versionGroups, packageFields: config.packageFields, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  for (const [i, g] of (merged.versionGroups || []).entries()) {
    if (!g || typeof g !== 'object') throw new UsageError(`versionGroups[${i}] must be an object`);
    if (g.policy && !['pin', 'sameRange', 'banned', 'ignored', 'highestSemver'].includes(g.policy)) throw new UsageError(`versionGroups[${i}].policy must be pin, sameRange, banned, ignored or highestSemver`);
    if ((g.policy === 'pin') && !g.pinVersion) throw new UsageError(`versionGroups[${i}] has policy "pin" but no pinVersion`);
  }
  let { info, findings } = analyze(resolve(dir), merged);
  let fixed;
  if (merged.fix) {
    fixed = applyFixes(resolve(dir), findings, { majors: merged.fixMajors, dryRun: merged.fixDryRun });
    if (fixed.length && !merged.fixDryRun) ({ info, findings } = analyze(resolve(dir), merged));
  }
  const tool = { name: 'monorepo-gauge', version: opts.toolVersion || '1.0.0', rules: RULES, emoji: '🧩', defaultFile: 'package.json' };
  const clean = findings.map(({ edit, edits, risky, ...f }) => ({ ...f, ...(edit || edits?.length ? { fixable: true } : {}) }));
  return buildReport(tool, `${info.packages.length} workspace package(s)`, clean, config, { now: opts.now, configFile, ...(fixed ? { fixed } : {}), summaryLine: `${info.manager} workspaces from ${info.sources.join(', ')}: ${info.packages.map((p) => p.name).slice(0, 8).join(', ')}${info.packages.length > 8 ? ', …' : ''}`, info });
}
