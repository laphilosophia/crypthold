# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-14

### Added

- HKDF-SHA256 key derivation for enhanced security (master keys are now used to derive unique encryption keys)
- File Format V1: Structured JSON format with metadata header (`v`, `kdf`, `salt`, `keyId`)
- Atomic write strategy using temporary files to prevent data corruption during crashes
- Automatic migration support from v1.0.0 legacy format
- Optimistic concurrency control using file snapshotting (`mtime` and `size` checks)
- File size guard (default 10MB) to prevent loading oversized files
- Unix-specific file mode enforcement (0600) for stored configuration

### Changed

- Normalized error codes for robust programmatic handling (e.g., `OPAL_INTEGRITY_FAIL`, `OPAL_CONFLICT`, `OPAL_FILE_TOO_LARGE`)

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
