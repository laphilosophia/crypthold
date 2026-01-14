# Implementation

## 📦 1. Implementation: `src/cipher.ts`

*Features: 12-byte IV (NIST Standard) and AAD support.*

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV (NIST Recommended for GCM)

export interface EncryptedPayload {
  iv: string;
  tag: string;
  content: string;
  aad: string;
}

export class Cipher {
  static encrypt(text: string, masterKey: Buffer, context: string): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, masterKey, iv);

    // AAD: Context Binding (Prevent Cross-App Replay)
    cipher.setAAD(Buffer.from(context, 'utf8'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      content: encrypted,
      aad: context
    };
  }

  static decrypt(payload: EncryptedPayload, masterKey: Buffer, expectedContext: string): string {
    if (payload.aad !== expectedContext) {
      throw new Error(`Opal: Context Mismatch. Data belongs to '${payload.aad}', expected '${expectedContext}'`);
    }

    const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(payload.iv, 'hex'));

    decipher.setAAD(Buffer.from(payload.aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

    let decrypted = decipher.update(payload.content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

```

---

## 📦 2. Implementation: `src/index.ts`

*Additions: `getAll()` method and updated imports.*

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { Keyring } from '@napi-rs/keyring';
import { Cipher, EncryptedPayload } from './cipher';
import { randomBytes } from 'crypto';

interface OpalOptions {
  appName: string;
  configPath?: string;
  encryptionKeyEnvVar?: string;
}

export class OpalError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'OpalError';
  }
}

export class Opal {
  private keyring: Keyring;
  private filePath: string;
  private options: OpalOptions;

  // State Guard: null indicates not loaded
  private memoryCache: Record<string, any> | null = null;

  constructor(options: OpalOptions) {
    if (!options.appName) throw new Error('Opal: appName is required');

    this.options = options;
    this.keyring = new Keyring({
      serviceName: options.appName,
      account: 'default',
    });

    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    this.filePath = options.configPath || path.join(homeDir, '.config', options.appName, 'store.enc');
  }

  async init(): Promise<void> {
    try {
      await this.getMasterKey();
      throw new OpalError('Store already initialized. Use load() instead.', 'OPAL_ALREADY_INIT');
    } catch (e: any) {
      if (e.code === 'OPAL_KEY_NOT_FOUND') {
        const newKey = randomBytes(32).toString('hex');
        await this.keyring.setPassword(newKey);

        this.memoryCache = {};
        await this.saveData({});
        return;
      }
      throw e;
    }
  }

  async load(): Promise<void> {
    const key = await this.getMasterKey();

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const payload: EncryptedPayload = JSON.parse(raw);
      const jsonStr = Cipher.decrypt(payload, key, this.options.appName);
      this.memoryCache = JSON.parse(jsonStr);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
         this.memoryCache = {};
         return;
      }
      throw error;
    }
  }

  private async getMasterKey(): Promise<Buffer> {
    let keyHex: string | null = null;

    if (this.options.encryptionKeyEnvVar && process.env[this.options.encryptionKeyEnvVar]) {
      keyHex = process.env[this.options.encryptionKeyEnvVar]!;
    } else {
      keyHex = await this.keyring.getPassword();
    }

    if (!keyHex) {
      throw new OpalError(
        `Master key not found for service: ${this.options.appName}. Run 'init()' first.`,
        'OPAL_KEY_NOT_FOUND'
      );
    }

    const keyBuffer = Buffer.from(keyHex, 'hex');
    // 32 bytes = 256 bits (AES-256 requirement)
    if (keyBuffer.length !== 32) {
      throw new OpalError(
        'Invalid master key length. Key must be 64 hex characters (32 bytes).',
        'OPAL_INVALID_KEY'
      );
    }

    return keyBuffer;
  }

  // --- Public API ---

  async set(key: string, value: any): Promise<void> {
    this.ensureLoaded();
    this.memoryCache![key] = value;
    await this.saveData(this.memoryCache!);
  }

  async get<T>(key: string): Promise<T | null> {
    this.ensureLoaded();
    if (key in this.memoryCache!) {
      return this.memoryCache![key] as T;
    }
    return null;
  }

  /**
   * Retrieves all configuration data.
   * Returns a shallow copy to prevent internal cache mutation.
   */
  async getAll(): Promise<Record<string, any>> {
    this.ensureLoaded();
    return { ...this.memoryCache! };
  }

  async delete(key: string): Promise<void> {
    this.ensureLoaded();
    if (key in this.memoryCache!) {
      delete this.memoryCache![key];
      await this.saveData(this.memoryCache!);
    }
  }

  // --- Helpers ---

  private ensureLoaded() {
    if (this.memoryCache === null) {
      throw new OpalError(
        'Store is not loaded. Call await store.load() first.',
        'OPAL_NOT_LOADED'
      );
    }
  }

  private async saveData(data: Record<string, any>): Promise<void> {
    const key = await this.getMasterKey();
    const jsonStr = JSON.stringify(data);
    const payload = Cipher.encrypt(jsonStr, key, this.options.appName);

    const dir = path.dirname(this.filePath);
    const tempPath = `${this.filePath}.${randomBytes(4).toString('hex')}.tmp`;

    await fs.mkdir(dir, { recursive: true });

    try {
      // Atomic Write Strategy: Write to tmp -> Rename
      await fs.writeFile(tempPath, JSON.stringify(payload, null, 2));
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }
}
