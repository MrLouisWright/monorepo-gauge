# Changelog

## 1.0.0 (2026-10-14)

First release, by Louis Wright.

- Workspace discovery from package.json `workspaces` (array or object), `pnpm-workspace.yaml` and `lerna.json`, with `*`/`**` globs and `!` exclusions.
- Internal dependency graph with cycle detection (production and dev cycles separately) and a SemVer range checker (`^`, `~`, x-ranges, hyphen ranges, `||`, `workspace:` protocol).
- Rules: duplicate-package-name, circular-dependency, internal-range-mismatch, private-dependency, dependency-major-drift, root-not-private, missing-field, workspace-empty, dependency-range-drift, version-drift, field-drift, repository-directory, circular-dev-dependency, workspace-protocol.
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
