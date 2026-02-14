# Crypthold

Secure, hardened, atomic configuration store for Node.js applications.

[![npm](https://img.shields.io/npm/v/crypthold.svg)](https://www.npmjs.com/package/crypthold)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache2.0-blue.svg)](LICENSE)

Crypthold is a production-grade configuration substrate designed for high-integrity environments. It provides tamper-evident storage, cross-process safety, and seamless key management.

## Features

- **Hardened Security:** AES-256-GCM encryption with HKDF-SHA256 key derivation.
- **Integrity First:** SHA-256 content hashing prevents silent external tampering.
- **Concurrency Safe:** Robust cross-process locking (`.lock`) with automatic stale recovery.
- **Reactive:** Live configuration watching with debounced callbacks.
- **Key Lifecycle:** Native rotation support and multi-key fallback decryption.
- **Production Ready:** Atomic writes, `fsync` support, and comprehensive diagnostic reports.
- **OS Keychain:** Native integration via `@napi-rs/keyring`.

## Installation

```bash
npm install crypthold
```

## Quick Start

```typescript
import { Crypthold } from 'crypthold'

const store = new Crypthold({ appName: 'my-app' })

// Initialize (once) or Load
await store.load()

// Set and Persist
await store.set('db_password', 'secret123')

// Get with Types
const pass = store.get<string>('db_password')
```

## Advanced Usage

### Reactive Configuration

Watch for external changes (e.g., manual file edits or other processes):

```typescript
store.watch(
  (data) => {
    console.log('Config updated:', data)
  },
  { debounceMs: 50 },
)
```

> `deterministicSeed` is intended for tests only and now throws outside `NODE_ENV=test`.

### Key Rotation

Transition to a new master key without data loss:

```typescript
await store.rotate('new-64-char-hex-key')
```

### Diagnostics (Doctor)

Check the health and integrity of your configuration store:

```typescript
const report = await store.doctor()
// { keyPresent: true, integrityOk: true, permissionsOk: true, lockExists: false ... }
```

### Durability

Ensures data is physically written to disk (useful for high-stakes environments):

```typescript
const store = new Crypthold({
  appName: 'my-app',
  durability: 'fsync',
})
```

Ensures data is physically written to disk (useful for high-stakes environments):

```typescript
const store = new Crypthold({
  appName: 'my-app',
  encryptionKeyEnvVar: 'CRYPTHOLD_KEY',
})
await store.load()
```

## Examples

The [examples/](examples/) directory contains detailed demonstration scripts for advanced scenarios:

- **[Key Lifecycle](examples/demo-key-lifecycle.ts):** Demonstrates multi-key fallback decryption and atomic key rotation.
- **[DX & Safety](examples/demo-doctor-watch-import-export.ts):** Shows usage of the `doctor()` diagnostic report, `watch()` for live updates, and encrypted import/export.
- **[Durability & Tests](examples/demo-deterministic-durability.ts):** Covers `fsync` durability modes, optimistic concurrency conflict detection, and deterministic test mode.

Run any example with:

```bash
npm run build
node --experimental-strip-types examples/filename.ts
```

## API Reference

### `new Crypthold(options)`

| Option                   | Type                     | Description                                              |
| :----------------------- | :----------------------- | :------------------------------------------------------- |
| `appName`                | `string`                 | **Required.** Service name for Keychain and AAD context. |
| `configPath`             | `string`                 | Custom path for the encrypted store file.                |
| `encryptionKeyEnvVar`    | `string`                 | Env var name for the primary master key.                 |
| `encryptionKeySetEnvVar` | `string`                 | Env var for multi-key sets (`id1:hex,id2:hex`).          |
| `maxFileSizeBytes`       | `number`                 | Limit to prevent memory blow (default: 10MB).            |
| `durability`             | `"normal" \| "fsync"`    | Atomic write strategy (default: `"normal"`).             |
| `lockTimeoutMs`          | `number`                 | Max wait time for lock acquisition (default: 5s).        |
| `conflictDetection`      | `"strict" \| "metadata"` | Conflict check mode (`strict` default).                  |

### Methods

| Method                  | Description                                                   |
| :---------------------- | :------------------------------------------------------------ |
| `init()`                | Generates a new master key in the keychain.                   |
| `load()`                | Loads and decrypts the store. Supports legacy migration.      |
| `get<T>(key)`           | Retrieves a value from memory cache.                          |
| `set(key, value)`       | Updates memory cache and persists atomically.                 |
| `rotate(newKey?)`       | Re-encrypts the entire store with a new key.                  |
| `watch(callback)`       | Starts watching for file changes. Returns `unwatch` function. |
| `doctor()`              | Performs diagnostic checks on keys and file integrity.        |
| `exportEncrypted(path)` | Safely clones the encrypted store.                            |
| `importEncrypted(path)` | Loads an external store into the local substrate.             |

## Error Codes

| Code                       | Description                                                   |
| :------------------------- | :------------------------------------------------------------ |
| `CRYPTHOLD_INTEGRITY_FAIL` | Decryption or AAD verification failed (Tampering detected).   |
| `CRYPTHOLD_CONFLICT`       | File changed externally during a write (Hash/mtime mismatch). |
| `CRYPTHOLD_LOCK_TIMEOUT`   | Failed to acquire process lock within timeout.                |
| `CRYPTHOLD_FILE_TOO_LARGE` | Store exceeds `maxFileSizeBytes` limit.                       |
| `CRYPTHOLD_KEY_NOT_FOUND`  | Master key is missing from environment/keychain.              |
| `CRYPTHOLD_UNSAFE_OPTION`  | A test-only option was used in a non-test environment.        |

## Security

- **Engineering Analysis:** See the detailed [Risk Matrix analysis](RISK_MATRIX_ANALYSIS.md).
- **Encryption:** AES-256-GCM with 96-bit random IV (NIST SP 800-38D).
- **Key Derivation:** HKDF-SHA256 ensures key separation for every write.
- **Binding:** AAD (Additional Authenticated Data) binds ciphertext to your `appName`.
- **Permissions:** Enforces `0600` (Owner Read/Write) on Unix-like systems.

## Security FAQ

### Risk matrix summary: how is integrity protected, and what about attestation?

Based on the project risk matrix review, Crypthold currently mitigates **8/9 primary risks** and has one explicit gap acknowledged below.

**Integrity controls implemented**

- **Nonce reuse protection (strong):** Every encryption uses a random 96-bit IV, and each write derives a fresh encryption key via HKDF-SHA256 with new salt.
- **Tamper/corruption detection (strong):** AES-256-GCM authentication + AAD context binding (`appName`) ensures ciphertext cannot be modified or replayed across apps without detection.
- **Silent overwrite prevention (strong):** Cross-process lockfiles (`O_EXCL`) plus optimistic conflict checks (`mtime`, `size`, and SHA-256 content hash).
- **Power-loss safety (good):** Atomic write pattern (`.tmp` + `rename`) with optional `fsync` durability mode.
- **Stale lock recovery (good):** Timeout-based cleanup for dead writers.

**Known gap from the matrix**

- **Weak master key quality:** Key length is enforced, but entropy quality is not currently scored. This is tracked as an improvement area.

**Attestation position**

Crypthold itself is focused on storage integrity and multi-process safety. Attestation is a complementary layer we recommend in deployment:

1. **Build/runtime attestation** (provenance, signed artifacts, reproducible builds) to verify what code is running.
2. **Operational attestation** (identity and policy-bound approvals) to verify who executed sensitive key/config actions.
3. **Source attestation** (device/workload identity, signed upstream events) to increase trust in where inputs originated.

**Proof boundaries (important)**

- **What Crypthold can prove:** encrypted state has not been silently modified, replayed across apps, or overwritten without detection within the configured trust boundary.
- **What Crypthold cannot prove alone:** that the original input values were true/correct at the moment they were created.
- **Implication:** if false data enters at ingestion time, Crypthold can preserve that data consistently, but cannot independently certify its real-world truth.

So: Crypthold gives strong integrity at rest; attestation and trustworthy input pipelines are required to improve truthfulness guarantees.

## License

Apache-2.0
