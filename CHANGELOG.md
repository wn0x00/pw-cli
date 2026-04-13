# Changelog

## 0.0.21

### Patch Changes

- Fix `utilsBundleImpl` loading for global npm installs where `exports` field blocks deep subpath requires.
- Support `PLAYWRIGHT_MCP_EXTENSION_TOKEN` environment variable for authenticated extension relay connections.

## 0.0.19

### Patch Changes

- Fix `--extension` startup on installs where `playwright-core/lib/utilsBundleImpl` is exposed as a directory entrypoint instead of a flat file path.

## 0.0.18

### Patch Changes

- Add `run-script --extension` and `run-code --extension` support via Playwright MCP Bridge relay, and document the new bridge workflow.

All notable changes to this project should be documented in this file.

## [0.0.1] - 2026-04-07

- Initial public open source baseline
- Added README, contribution docs, security policy, and GitHub templates
- Added Node.js built-in tests and CI workflow
