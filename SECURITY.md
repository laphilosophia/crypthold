# Security Policy

Crypthold is a security-focused project. We take the security of our users and their data very seriously.

## Supported Versions

Only the latest major version of Crypthold is supported for security updates.

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, please report it privately by sending an email to [me@erdem.work](mailto:me@erdem.work).

Please include the following information in your report:

- Type of issue (e.g., buffer overflow, SQL injection, RCE)
- Full paths of source file(s) related to the manifestation of the issue
- Location of the affected code (tag/branch/commit or direct URL)
- A proof-of-concept or exploit code to help us reproduce the issue

We will acknowledge receipt of your report within 48 hours and provide a timeline for a fix if necessary.

## Security Guarantees

Crypthold aims to provide:

- **Confidentiality:** AES-256-GCM encryption.
- **Integrity:** SHA-256 content hashing and AAD binding.
- **Durability:** Atomic writes and `fsync` support.
- **Process Safety:** File-based locking mechanisms.

## Threat Model Notes

- **Hostile filesystem model:** Crypthold assumes local files may be read/modified externally, and therefore authenticates ciphertext with AES-GCM and context-bound AAD (`appName`).
- **Cross-process safety:** Writes are guarded by lockfiles and atomic rename, with stale-lock recovery.
- **Conflict detection:** File snapshot checks (`mtime`, `size`, optional content hash) detect out-of-band file changes between load and save cycles.
- **Key quality caveat:** HKDF provides key separation, but does not increase entropy of weak key material. Crypthold enforces key format/length, not entropy strength.
- **Rollback caveat:** Replacing the store with an older valid ciphertext is not cryptographically prevented today (no monotonic anti-rollback counter in payload).
- **Privileged host caveat:** Root/admin memory or environment-variable extraction is considered out-of-scope.
