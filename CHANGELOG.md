# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-14

### Added

- Initial release
- AES-256-GCM encryption with 96-bit IV (NIST compliant)
- OS Keychain integration via `@napi-rs/keyring`
- Environment variable key support for CI/CD
- Atomic write strategy (temp file + rename)
- AAD context binding to prevent cross-app replay
- Full API: `init()`, `load()`, `get()`, `getAll()`, `set()`, `delete()`
- TypeScript support with ESM/CJS dual build
