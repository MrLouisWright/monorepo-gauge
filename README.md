# monorepo-gauge

> Hygiene checks for npm, yarn and pnpm workspaces: circular internal deps, mismatched shared deps, version drift and missing fields.

Monorepos rot quietly. A package bumps to 2.0.0 while a sibling still asks for `^1.0.0`, so the package manager fetches the old copy from the registry instead of linking the local one. One app moves to React 18 and another stays on 17. Two packages end up importing each other. A published package depends on a private one that users can never install. `monorepo-gauge` reads your workspace layout and reports these problems with the file, a severity and a **concrete fix**.

CLI, library and GitHub Action. Node.js 18+, **zero runtime dependencies**. By Louis Wright.

## Features

- **Workspace discovery:** `package.json` `workspaces` (array or `{ packages }`), `pnpm-workspace.yaml` and `lerna.json`, with `*`, `**` and `!exclusions`. The package manager is detected from the lockfile, `.yarnrc.yml` and `packageManager`.
- **Internal graph:** cycles through `dependencies`/`peerDependencies`/`optionalDependencies` (high) and through `devDependencies` (low), each reported once as `a → b → c → a`. Internal ranges are checked against the local version with a proper SemVer range matcher (`^`, `~`, x-ranges, hyphen ranges, `||`, `workspace:^1.2.0`). Published packages depending on private ones are caught.
- **Shared dependency drift:** the same external dependency with different majors (medium) or different ranges in the same major (low) across packages and the root, listing who uses what.
- **Package fields:** required fields for publishable packages (default `name`, `version`, `description`, `license`, `repository`), `repository.directory` pointing at the right folder, and `license`/`engines.node`/`type` consistency. Under fixed versioning (lerna `version`, or `--versioning fixed`) package versions must match.
- **Output:** text, JSON, SARIF 2.1.0 and Markdown; `--fail-on`; exit codes 0/1/2; allowlist entries with expiry dates.

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
| `missing-field` | medium | Package is missing a required package.json field |
| `workspace-empty` | medium | Workspace pattern matches no packages |
| `dependency-range-drift` | low | Packages use different ranges for the same dependency (same major) |
| `version-drift` | low | Package versions differ under fixed/locked versioning |
| `field-drift` | low | license / engines / type differs from the rest of the monorepo |
| `repository-directory` | low | repository.directory is missing or wrong |
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
  "ignorePackages": ["@acme/sandbox-*"]
}
```

- **`severity`** changes a rule's severity, or turns it `"off"`.
- **`allowlist`** entries suppress matching findings. Each needs a `reason` and matches on any combination of `rule`, `file`, `subject` (globs with `*`) and `match` (a substring of the message). Add `expires` (`YYYY-MM-DD`) so the exception is time-boxed: once it lapses the finding comes back along with an `allowlist-expired` finding (medium). Entries that no longer match anything are reported as `allowlist-unused` (info).

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

The action runs the bundled CLI with Node 20; it has no dependencies to install. Pin it to a commit SHA if your policy requires it.

## Library

```js
import { check, satisfies, findCycles } from 'monorepo-gauge';
const report = check('.', { versioning: 'fixed' });
for (const p of report.info.packages) console.log(p.name, p.internalDeps);
satisfies('2.0.0', '^1.0.0'); // false
```

Types are included.

## Requirements

Node.js 18 or newer. Zero runtime dependencies.

## Licence

MIT © Louis Wright. See [LICENSE](LICENSE).
