# monorepo-gauge

[![npm version](https://img.shields.io/npm/v/monorepo-gauge.svg)](https://www.npmjs.com/package/monorepo-gauge) [![CI](https://github.com/MrLouisWright/monorepo-gauge/actions/workflows/ci.yml/badge.svg)](https://github.com/MrLouisWright/monorepo-gauge/actions/workflows/ci.yml) [![Node](https://img.shields.io/node/v/monorepo-gauge.svg)](https://nodejs.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Hygiene checks for npm, yarn and pnpm workspaces: circular internal deps, mismatched shared deps, version drift and missing fields.

Monorepos rot quietly. A package bumps to 2.0.0 while a sibling still asks for `^1.0.0`, so the package manager fetches the old copy from the registry instead of linking the local one. One app moves to React 18 and another stays on 17. Two packages end up importing each other. A published package depends on a private one that users can never install. `monorepo-gauge` reads your workspace layout and reports these problems with the file, a severity and a **concrete fix**.

CLI, library and GitHub Action. Node.js 18+, one runtime dependency ([pkg-field-gauge](https://www.npmjs.com/package/pkg-field-gauge)). By Louis Wright.

## Features

- **Workspace discovery:** `package.json` `workspaces` (array or `{ packages }`), `pnpm-workspace.yaml` and `lerna.json`, with `*`, `**` and `!exclusions`. The package manager is detected from the lockfile, `.yarnrc.yml` and `packageManager`.
- **Internal graph:** cycles through `dependencies`/`peerDependencies`/`optionalDependencies` (high) and through `devDependencies` (low), each reported once as `a → b → c → a`. Internal ranges are checked against the local version with a proper SemVer range matcher (`^`, `~`, x-ranges, hyphen ranges, `||`, `workspace:^1.2.0`). Published packages depending on private ones are caught.
- **Shared dependency drift:** the same external dependency with different majors (medium) or different ranges in the same major (low) across packages and the root, listing who uses what.
- **Package fields, delegated to [pkg-field-gauge](https://www.npmjs.com/package/pkg-field-gauge):** every workspace runs through pkg-field-gauge's `checkPackage` (entry points, `exports`, types, `bin`, `files`, licence, repository, description, keywords…) and each result is reported as `package-field` with pkg-field-gauge's own severity and a subject like `@acme/ui:entry-missing:main:dist/index.js`. Private workspaces skip the publishing-only rules. Extra `requiredFields` (e.g. `engines.node`, `author`) become `required-field` results. monorepo-gauge itself keeps the cross-package checks: `repository.directory` pointing at the right folder, and `license`/`engines.node`/`type` consistency. Under fixed versioning (lerna `version`, or `--versioning fixed`) package versions must match.
- **`workspace:` protocol:** mixed `workspace:^` / `workspace:~` / `workspace:*` / `workspace:<range>` styles are flagged (`workspace-protocol-inconsistent`, majority wins or set `workspaceProtocolStyle`), and `workspace:` under npm or yarn classic, which fails with `EUNSUPPORTEDPROTOCOL`, is high (`workspace-protocol-unsupported`).
- **Version groups (syncpack-style):** `versionGroups` assign dependencies × packages to a policy: `pin` (exact `pinVersion`), `sameRange`, `banned` or `ignored`. Unmatched dependencies use the default "highest range wins" drift check.
- **`--fix`:** rewrites `package.json` files in place (keeping indentation): internal ranges, `workspace:` protocol and style, fixed-mode versions, same-major range drift, `pin` groups and `repository.directory`. Major drift is only aligned with `--fix-majors`. `--dry-run` prints the changes without writing. Re-run your package manager's install afterwards to update the lockfile.
- **Output:** text, JSON, SARIF 2.1.0 and Markdown; `--fail-on`; exit codes 0/1/2; allowlist entries with expiry dates.



### Module formats and types

Ships **ESM and CommonJS** (`import` and `require` both work, via `exports`), with TypeScript declarations generated from the source at build time. Tests run on Node 18/20/22 in GitHub Actions (`test/`), including require/import checks against the packed tarball; releases are published with npm provenance.


## Rules

| Rule | Default severity | What it catches |
|---|---|---|
| `duplicate-package-name` | critical | Two workspaces have the same package name |
| `circular-dependency` | high | Internal packages depend on each other in a cycle |
| `internal-range-mismatch` | high | Internal dependency range does not match the local package version |
| `private-dependency` | high | Publishable package depends on a private workspace package |
| `invalid-package-json` | high | Workspace package.json cannot be parsed |
| `dependency-major-drift` | medium | Packages require different major versions of the same dependency |
| `root-not-private` | medium | Workspace root is not marked "private": true |
| `package-field` | from pkg-field-gauge | Finding from pkg-field-gauge for one workspace package |
| `banned-dependency` | high | Dependency is banned by a versionGroups policy |
| `workspace-protocol-unsupported` | high | workspace: protocol with npm or yarn classic |
| `version-group-mismatch` | medium | Range breaks its versionGroups policy (pin / sameRange) |
| `workspace-empty` | medium | Workspace pattern matches no packages |
| `dependency-range-drift` | low | Packages use different ranges for the same dependency (same major) |
| `version-drift` | low | Package versions differ under fixed/locked versioning |
| `field-drift` | low | license / engines / type differs from the rest of the monorepo |
| `repository-directory` | low | repository.directory is missing or wrong |
| `workspace-protocol-inconsistent` | low | Internal dependencies mix workspace: styles |
| `circular-dev-dependency` | low | Cycle through devDependencies |
| `workspace-protocol` | info | Internal dependency does not use the workspace: protocol |
| `allowlist-expired` | medium | Allowlist entry has expired |
| `allowlist-unused` | info | Allowlist entry matched nothing |

## Install and run

```bash
npx monorepo-gauge                       # run at the monorepo root
npx monorepo-gauge --fail-on medium
npx monorepo-gauge --versioning fixed    # all publishable packages share one version
npx monorepo-gauge --ignore-packages "playground-*,examples/**"
```

### Sample output

```text
monorepo-gauge — 6 workspace package(s)
pnpm workspaces from pnpm-workspace.yaml: a, b, c, dup, dup, priv

CRITICAL packages/dup2/package.json "dup" is the name of 2 workspaces: packages/dup1, packages/dup2 [duplicate-package-name]
         ↳ fix: Give each workspace a unique name.
HIGH     packages/a/package.json circular dependency: a → b → c → a [circular-dependency]
         ↳ fix: Break the cycle by extracting the shared code into a new package or inverting one dependency.
HIGH     packages/b/package.json b dependencies: "c": "^2.0.0" does not match the local c@1.0.0 [internal-range-mismatch]
         ↳ fix: Use "^1.0.0" or "workspace:^"; otherwise the package manager installs c from the registry instead of linking it.
MEDIUM   packages/c/package.json react: ^18.2.0 (a) vs ^17.0.2 (c) [dependency-major-drift]
         ↳ fix: Align every package on one major (e.g. "^18.2.0"); mixed majors install duplicate copies and break singletons.
```

## Options

```text
monorepo-gauge 1.0.0 — hygiene checks for npm, yarn and pnpm workspaces

Usage: monorepo-gauge [root] [options]

Workspace
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

Common
  -c, --config <file>     JSON config (default: .monorepo-gauge.json or "monorepoGauge" in package.json)
  -f, --format <fmt>      text (default) | json | sarif | markdown
      --json <file>       Also write a JSON report
      --sarif <file>      Also write SARIF 2.1.0
      --markdown <file>   Also write Markdown (e.g. for a job summary)
      --fail-on <sev>     critical | high | medium | low | info | none (default: high)
      --list-rules        Print rules and default severities
      --no-fixes          Hide fix suggestions in text output
      --no-color          Disable colours
  -v, --version / -h, --help

Exit codes: 0 = passed, 1 = findings at or above --fail-on, 2 = usage, config or read error.
```

## Configuration and allowlist

Options can live in `.monorepo-gauge.json` (or a `"monorepoGauge"` key in `package.json`, or `--config <file>`):

```json
{
  "failOn": "medium",
  "severity": { "field-drift": "low" },
  "allowlist": [
    { "rule": "dependency-major-drift", "subject": "react", "reason": "Legacy app stays on React 17 until the Q2 migration", "expires": "2027-03-31" }
  ],
  "requiredFields": ["name", "version", "description", "license", "repository", "engines"],
  "versioning": "fixed",
  "ignorePackages": ["@acme/sandbox-*"],
  "workspaceProtocolStyle": "^",
  "packageFields": { "skip": ["keywords-missing"] },
  "versionGroups": [
    { "label": "legacy app", "packages": ["@acme/legacy-*"], "policy": "ignored" },
    { "dependencies": ["react", "react-dom"], "policy": "pin", "pinVersion": "18.3.1" },
    { "dependencies": ["moment"], "policy": "banned", "reason": "Use date-fns." },
    { "dependencies": ["@types/**"], "dependencyTypes": ["devDependencies"], "policy": "sameRange" }
  ]
}
```

- **`severity`** changes a rule's severity, or turns it `"off"`.
- **`allowlist`** entries suppress matching findings. Each needs a `reason` and matches on any combination of `rule`, `file`, `subject` (globs with `*`) and `match` (a substring of the message). Add `expires` (`YYYY-MM-DD`) so the exception is time-boxed: once it lapses the finding comes back along with an `allowlist-expired` finding (medium). Entries that no longer match anything are reported as `allowlist-unused` (info).

- **`versionGroups`** are tried in order; the first group whose `dependencies`, `packages` (globs, `(root)` for the root package) and optional `dependencyTypes` match a usage owns it.
- **`packageFields`** is passed to pkg-field-gauge: `rules` (only these), `skip`, `pack: true` (also check the packed tarball); `false` turns per-package checks off.

Other config keys: `requiredFieldsPrivate` (default `["name"]`), `consistentFields` (default `["license", "engines.node", "type"]`), `ignoreDeps`, `includePeers`, and `"workspaceProtocol": false` to silence the `workspace:` suggestion.

## Output and exit codes

- `--format text` (default), `json`, `sarif` (SARIF 2.1.0 for GitHub code scanning) or `markdown` (for job summaries and PR comments). `--json`, `--sarif` and `--markdown` write extra report files in the same run.
- `--fail-on <severity>` sets the threshold (`critical`, `high`, `medium`, `low`, `info`, `none`; default `high`).
- Exit codes: **0** passed, **1** findings at or above `--fail-on`, **2** usage, config or read error.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload
jobs:
  monorepo-gauge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { persist-credentials: false }
      - uses: MrLouisWright/monorepo-gauge@v1
        with:
          fail-on: high
          sarif: monorepo-gauge.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: monorepo-gauge.sarif }
```

| Input | Description | Default |
|---|---|---|
| `path` | Project directory | `.` |
| `fail-on` | Failure threshold | `high` |
| `config` | Config file path | |
| `sarif` / `json` | Write SARIF / JSON report to this path | |
| `job-summary` | Add the Markdown report to the job summary | `true` |
| `args` | Extra CLI arguments | |

The action sets up Node 20, installs monorepo-gauge's runtime dependency (pkg-field-gauge) from its lockfile with `npm ci --omit=dev --ignore-scripts`, then runs the CLI. Pin it to a commit SHA if your policy requires it.

## Library

```js
import { check, applyFixes, satisfies, findCycles } from 'monorepo-gauge';
const report = check('.', { versioning: 'fixed' });
check('.', { fix: true, fixDryRun: true }).fixed; // [{ rule, file, path, from, to }]
for (const p of report.info.packages) console.log(p.name, p.internalDeps);
satisfies('2.0.0', '^1.0.0'); // false
```

Types are included.

## Requirements

Node.js 18 or newer. One runtime dependency: pkg-field-gauge.

## Support

If this project is useful to you, you can support its development with a donation: [Buy me a coffee](https://donate.stripe.com/aFa00lek3cvX4Ds2Fk9EI0b). It helps keep these tools maintained, documented and free for everyone.

## Credit (optional)

Free to use under MIT, no attribution required. If monorepo-gauge helps you, a link back is appreciated:

```html
<a href="https://louiswright.co.uk">Built with monorepo-gauge by Louis Wright</a>
```

```markdown
[![Built with monorepo-gauge by Louis Wright](https://img.shields.io/badge/built%20with-monorepo--gauge-blue)](https://louiswright.co.uk)
```

## Licence

MIT © Louis Wright ([Louis Wright](https://github.com/MrLouisWright))
