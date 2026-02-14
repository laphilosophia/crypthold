# Crypthold Project Analysis: Risk & Mitigation Integrity

This document provides a detailed engineering analysis of Crypthold based on the Risk Matrix analysis. It evaluates the technical implementation against documented threats and identifies second-order effects.

## 0. Risk Matrix

| Risk                          | Impact       | Likelihood | Control                                        |
| ----------------------------- | ------------ | ---------- | ---------------------------------------------- |
| Nonce reuse (GCM)             | Catastrophic | Very low   | Random IV + key rotation + HKDF salt           |
| Weak master key               | High         | Medium     | HKDF + entropy warning + doctor                |
| Silent overwrite (multi-proc) | High         | Medium     | Lockfile + optimistic hash                     |
| Power loss data loss          | Medium       | Low        | fsync modu                                     |
| File tamper/corruption        | High         | Medium     | GCM tag + integrity normalization + size guard |
| Permission leak               | Medium       | Low        | 0600 enforce                                   |
| Migration bug → veri kaybı    | High         | Low        | two-phase atomic rewrite + tests               |
| Stale lock deadlock           | Medium       | Medium     | timestamp + cleanup                            |
| Memory blow (huge file)       | Medium       | Low        | max size guard                                 |

## 1. Executive Summary

Crypthold (`v2.0.0`) implements a hardened encrypted data store focused on multi-process safety and cryptographic integrity. The implementation addresses 8 out of 9 primary risks identified in the matrix. The cryptographic substrate is robust, using AES-256-GCM with AAD context binding and per-session key derivation via HKDF-SHA256.

## 2. Risk Mitigation Verification

### 2.1 Cryptographic Hardening

- **Nonce Reuse (GCM):** VERIFIED (Strong). The system uses random 12-byte IVs for every encryption operation. In addition, it employs a two-tier keying strategy: a unique encryption key is derived for every write using HKDF-SHA256 with a fresh 16-byte salt, effectively eliminating nonce-reuse risk even if the IV generator were degraded.
- **Weak Master Key:** VERIFIED (Moderate). HKDF is correctly used to separate master-key material from encryption keys.
  - **Gap identified:** while key length is validated, there is no technical entropy check (for example zxcvbn-like controls) to prevent weak but correctly sized keys (for example `00...00`).
- **Tamper/Corruption:** VERIFIED (Strong). AES-GCM authentication tags enforce integrity, and decryption failures are normalized to `CRYPTHOLD_INTEGRITY_FAIL` to avoid error-oracle leakage.

### 2.2 Concurrency & IO Safety

- **Silent Overwrite:** VERIFIED (Strong). Crypthold uses a multi-layered approach:
  1. **Strict Locking:** `LockManager` implements cross-process mutual exclusion via `O_EXCL` lock files.
  2. **Optimistic Concurrency:** `assertUnchangedSinceSnapshot` verifies `mtime`, `size`, and SHA-256 `contentHash` before writes.
- **Power Loss/Durability:** VERIFIED (Good). Uses the atomic rename pattern (`.tmp` write then `rename`) with optional `fsync` support for higher durability.
- **Stale Locks:** VERIFIED (Good). Locking includes stale-lock detection (30s) with automatic cleanup.

## 3. Mandatory Engineering Disclosure

### 3.1 Alternative Approaches

1. **OS-native locking (`flock` / `lockf`)**
   - **Why rejected:** Node.js locking support differs by platform; lockfiles with atomic `O_EXCL` are more portable and easier to inspect with `doctor()`.
2. **Streaming encryption (chunked GCM)**
   - **Why rejected:** Current target datasets are small-to-medium (<10MB). Whole-file GCM is simpler to implement and verify; chunked constructions can be introduced if limits increase.
3. **Chosen solution rationale**
   - Salted HKDF + random IV + GCM + AAD provides cryptographic domain separation. Binding `appName` via AAD helps prevent cross-app replay scenarios.

### 3.2 Affected Layers

- **Data Model:** Single-file JSON wrapped in a versioned envelope.
- **API / Contract:** `v2.0.0` introduces async entry points and strict `init()` vs `load()` semantics.
- **Runtime Behavior:** Lock acquisition blocks around write paths (`set()` / `saveData()`).
- **Observability:** Structured `DoctorReport` is exposed by `doctor()`.

### 3.3 Assumptions & Unknowns

**Assumptions**

1. Host OS provides atomic `rename(2)` semantics on supported filesystems.
2. `crypto.randomBytes` provides sufficient entropy quality.

**Unknowns**

1. Disk/firmware write caching can still affect physical durability beyond process-level `fsync` guarantees.
2. ENV-sourced key safety depends on deployment hygiene (for example K8s Secrets handling).

### 3.4 Second-Order Effects

- **Positive:** High-integrity local storage can act as a local root of trust for adjacent components.
- **Negative:** Write-on-set with full-file re-encryption increases SSD wear and tail latency near size limits.

## 4. Failure Modes & Rollback

| Failure Mode            | Result                                             | Rollback/Recovery                                                                                |
| :---------------------- | :------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **Crash during rename** | `store.enc` is old or new (or temporarily absent). | Atomic rename preserves consistency; failed rename leaves `.tmp` and keeps previous stable file. |
| **Integrity failure**   | `CRYPTHOLD_INTEGRITY_FAIL`                         | Restore from backup and investigate tampering vector.                                            |
| **Lock timeout**        | `CRYPTHOLD_LOCK_TIMEOUT`                           | Retry operation and inspect orphaned locks using `doctor()`.                                     |

**Blast radius:** confined to one `store.enc`; cross-application corruption is constrained by independent lockfiles and app-bound AAD.

## 5. Self-Critique

- **Weakest assumption:** `mtime`-based conflict detection can be fragile on low-resolution filesystems, though hash checks mitigate this.
- **Fragility:** stale-lock cleanup at 30s can race with long-suspended processes.
- **Future bottleneck:** `JSON.parse` / `JSON.stringify` overhead becomes dominant as dataset size grows.

## 6. Effort Justification

The approach prioritizes probabilistic security and data safety over raw throughput. AAD binding plus salted HKDF derivation aligns with robust GCM usage guidance and improves long-term resilience under sustained write volumes.
