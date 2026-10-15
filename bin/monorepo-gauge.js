#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mainCli, check, RULES, splitList, UsageError } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mainCli({
  name: 'monorepo-gauge', version: pkg.version, configKey: 'monorepoGauge', rules: RULES,
  tagline: 'hygiene checks for npm, yarn and pnpm workspaces',
  usage: 'Usage: monorepo-gauge [root] [options]',
  help: `Workspace
      --versioning <mode>     fixed | independent (default: from lerna.json, else independent)
      --require <fields>      Required fields for publishable packages (default: name,version,description,license,repository)
      --ignore-packages <g>   Package names or dirs to skip (globs, comma-separated)
      --ignore-deps <g>       External dependencies to skip in drift checks
      --include-peers         Include peerDependencies in drift checks
      --protocol-style <s>    Expected workspace: style: ^ | ~ | * | range (default: majority)
      --no-package-fields     Skip per-package checks (delegated to pkg-field-gauge)

Fixing
      --fix                   Rewrite package.json files: internal ranges, workspace: protocol,
                              fixed-mode versions, same-major range drift, versionGroups pins,
                              repository.directory
      --fix-majors            Also align dependencies across majors (may break code)
      --dry-run               With --fix, only print what would change
`,
  options: { versioning: { type: 'string' }, require: { type: 'string', multiple: true }, 'ignore-packages': { type: 'string', multiple: true }, 'ignore-deps': { type: 'string', multiple: true }, 'include-peers': { type: 'boolean' }, 'protocol-style': { type: 'string' }, 'no-package-fields': { type: 'boolean' }, fix: { type: 'boolean' }, 'fix-majors': { type: 'boolean' }, 'dry-run': { type: 'boolean' } },
  run: async ({ dir, values: o, config, configFile }) => {
    if (o.versioning && !['fixed', 'independent'].includes(o.versioning)) throw new UsageError(`Invalid --versioning: ${o.versioning}`);
    if (o['protocol-style'] && !['^', '~', '*', 'range'].includes(o['protocol-style'])) throw new UsageError(`Invalid --protocol-style: ${o['protocol-style']}`);
    const report = check(dir, { fix: o.fix || undefined, fixMajors: o['fix-majors'] || undefined, fixDryRun: o['dry-run'] || undefined, workspaceProtocolStyle: o['protocol-style'], packageFields: o['no-package-fields'] ? false : undefined,  versioning: o.versioning, requiredFields: o.require ? splitList(o.require) : undefined, ignorePackages: o['ignore-packages'] ? splitList(o['ignore-packages']) : undefined, ignoreDeps: o['ignore-deps'] ? splitList(o['ignore-deps']) : undefined, includePeers: o['include-peers'] || undefined, toolVersion: pkg.version }, config, configFile);
    if (report.fixed) {
      for (const x of report.fixed) process.stderr.write(`${o['dry-run'] ? 'would fix' : 'fixed'}: ${x.file} ${x.path}: ${JSON.stringify(x.from)} → ${JSON.stringify(x.to)} [${x.rule}]\n`);
      process.stderr.write(`${o['dry-run'] ? 'Would fix' : 'Fixed'} ${report.fixed.length} value(s).${o['dry-run'] || !report.fixed.length ? '' : ' Run your package manager install to update the lockfile.'}\n`);
    }
    return report;
  },
});
