# Changelog

## 1.0.0 (2026-10-15)

- Per-package field checks are delegated to pkg-field-gauge (`checkPackage`) and reported as `package-field` with its severities; private workspaces skip publishing-only rules. Replaces `missing-field`; `requiredFields` beyond pkg-field-gauge's own checks become `required-field` results.
- `--fix` (with `--dry-run` and `--fix-majors`) rewrites internal ranges, `workspace:` protocol and style, fixed-mode versions, same-major dependency drift, version-group pins and `repository.directory`.
- syncpack-style `versionGroups` with `pin`, `sameRange`, `banned` and `ignored` policies (rules `version-group-mismatch`, `banned-dependency`).
- `workspace:` protocol consistency: `workspace-protocol-inconsistent` (mixed styles, `--protocol-style`) and `workspace-protocol-unsupported` (npm / yarn classic).
- Dual ESM + CommonJS build with generated TypeScript declarations; CI checks require and import from the packed tarball.

First release, by Louis Wright.

- Workspace discovery from package.json `workspaces` (array or object), `pnpm-workspace.yaml` and `lerna.json`, with `*`/`**` globs and `!` exclusions.
- Internal dependency graph with cycle detection (production and dev cycles separately) and a SemVer range checker (`^`, `~`, x-ranges, hyphen ranges, `||`, `workspace:` protocol).
- Rules: duplicate-package-name, circular-dependency, internal-range-mismatch, private-dependency, dependency-major-drift, root-not-private, workspace-empty, dependency-range-drift, version-drift, field-drift, repository-directory, circular-dev-dependency, workspace-protocol.
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
