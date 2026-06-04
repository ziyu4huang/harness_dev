# Changelog

## [Unreleased]

### Added

- Initial documentation: README, CONTRIBUTING, CHANGELOG, and JSDoc annotations in source.
- `description` field in `package.json`.

## 0.1.0 — 2025-06-01

### Added

- Minimal CLI wrapper around DeepSeek API via Vercel AI SDK.
- Supports two model aliases: `pro` (`deepseek-v4-pro`) and `flash` (`deepseek-v4-flash`).
- `--model` flag for model selection; defaults to `pro`.
- `bun run build` target that outputs a standalone Bun bundle to `dist/deepseek-cli.js`.
