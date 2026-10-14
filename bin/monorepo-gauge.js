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
`,
  options: { versioning: { type: 'string' }, require: { type: 'string', multiple: true }, 'ignore-packages': { type: 'string', multiple: true }, 'ignore-deps': { type: 'string', multiple: true }, 'include-peers': { type: 'boolean' } },
  run: async ({ dir, values: o, config, configFile }) => {
    if (o.versioning && !['fixed', 'independent'].includes(o.versioning)) throw new UsageError(`Invalid --versioning: ${o.versioning}`);
    return check(dir, { versioning: o.versioning, requiredFields: o.require ? splitList(o.require) : undefined, ignorePackages: o['ignore-packages'] ? splitList(o['ignore-packages']) : undefined, ignoreDeps: o['ignore-deps'] ? splitList(o['ignore-deps']) : undefined, includePeers: o['include-peers'] || undefined, toolVersion: pkg.version }, config, configFile);
  },
});
