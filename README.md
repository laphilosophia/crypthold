# Opal

Secure, atomic, hybrid configuration store for Node.js CLI and desktop applications.

[![npm](https://img.shields.io/npm/v/@laphilosophia/opal.svg)](https://www.npmjs.com/package/@laphilosophia/opal)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

- **AES-256-GCM** encryption with AAD context binding
- **OS Keychain** integration via `@napi-rs/keyring`
- **Atomic writes** — crash-safe with temp file + rename
- **CI/CD ready** — env var key support
- **ESM & CJS** dual build with TypeScript

## Installation

```bash
npm install @laphilosophia/opal
```

## Quick Start

```typescript
import { Opal } from '@laphilosophia/opal'

const store = new Opal({ appName: 'my-app' })

// First time: initialize (creates key in OS keychain)
await store.init()

// Subsequent runs: load existing data
await store.load()

// Use it
await store.set('apiKey', 'sk-secret123')
console.log(store.get('apiKey')) // 'sk-secret123'

await store.delete('apiKey')
console.log(store.getAll()) // {}
```

## CI/CD Usage

Generate a 32-byte hex key and set it as an environment variable:

```bash
export OPAL_KEY=$(openssl rand -hex 32)
```

```typescript
const store = new Opal({
  appName: 'my-app',
  encryptionKeyEnvVar: 'OPAL_KEY',
})
await store.load()
```

## API

### `new Opal(options)`

| Option                | Type     | Required | Description                           |
| --------------------- | -------- | -------- | ------------------------------------- |
| `appName`             | `string` | ✅       | App name for keychain service and AAD |
| `configPath`          | `string` |          | Custom path for encrypted file        |
| `encryptionKeyEnvVar` | `string` |          | Env var name for master key           |

### Methods

| Method            | Description                         |
| ----------------- | ----------------------------------- |
| `init()`          | Create new store with generated key |
| `load()`          | Load existing store                 |
| `get<T>(key)`     | Get value by key                    |
| `getAll()`        | Get all values (shallow copy)       |
| `set(key, value)` | Set and persist value               |
| `delete(key)`     | Delete and persist                  |

### Error Codes

| Code                  | Description                               |
| --------------------- | ----------------------------------------- |
| `OPAL_KEY_NOT_FOUND`  | No master key found                       |
| `OPAL_ALREADY_INIT`   | Store already initialized                 |
| `OPAL_NOT_LOADED`     | Access before `load()`                    |
| `OPAL_INVALID_KEY`    | Invalid key format (must be 64 hex chars) |
| `OPAL_INTEGRITY_FAIL` | Decryption/AAD verification failed        |

## Security

- **Encryption:** AES-256-GCM with 96-bit IV (NIST SP 800-38D compliant)
- **Key Storage:** OS keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service)
- **Integrity:** Auth tag + AAD prevents tampering and cross-app replay

## License

MIT
