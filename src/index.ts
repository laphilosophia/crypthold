import { AsyncEntry } from '@napi-rs/keyring';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Cipher, EncryptedPayload } from './cipher.js';

export interface OpalOptions {
  /** Application name, used for keychain service and AAD context */
  appName: string;
  /** Custom path for encrypted config file */
  configPath?: string;
  /** Environment variable name containing master key (for CI/CD) */
  encryptionKeyEnvVar?: string;
}

export class OpalError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'OpalError';
  }
}

export class Opal {
  private filePath: string;
  private options: OpalOptions;

  // State Guard: null indicates not loaded
  private memoryCache: Record<string, unknown> | null = null;

  constructor(options: OpalOptions) {
    if (!options.appName) {
      throw new Error('Opal: appName is required');
    }

    this.options = options;

    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    this.filePath =
      options.configPath || path.join(homeDir, '.config', options.appName, 'store.enc');
  }

  /**
   * Initializes a new store. Throws OPAL_ALREADY_INIT if key exists.
   */
  async init(): Promise<void> {
    try {
      await this.getMasterKey();
      throw new OpalError('Store already initialized. Use load() instead.', 'OPAL_ALREADY_INIT');
    } catch (e: unknown) {
      if (e instanceof OpalError && e.code === 'OPAL_KEY_NOT_FOUND') {
        const newKey = randomBytes(32).toString('hex');
        const entry = new AsyncEntry(this.options.appName, 'default');
        await entry.setPassword(newKey);
        this.memoryCache = {};
        await this.saveData({});
        return;
      }
      throw e;
    }
  }

  /**
   * Loads existing store. Throws OPAL_KEY_NOT_FOUND if no key exists.
   */
  async load(): Promise<void> {
    const key = await this.getMasterKey();

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const payload: EncryptedPayload = JSON.parse(raw);
      const jsonStr = Cipher.decrypt(payload, key, this.options.appName);
      this.memoryCache = JSON.parse(jsonStr);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
      const entry = new AsyncEntry(this.options.appName, 'default');
      keyHex = (await entry.getPassword()) ?? null;
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

  /**
   * Sets a value and persists immediately.
   */
  async set(key: string, value: unknown): Promise<void> {
    this.ensureLoaded();
    this.memoryCache![key] = value;
    await this.saveData(this.memoryCache!);
  }

  /**
   * Retrieves a specific value by key.
   */
  get<T>(key: string): T | null {
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
  getAll(): Record<string, unknown> {
    this.ensureLoaded();
    return { ...this.memoryCache! };
  }

  /**
   * Deletes a key and persists immediately.
   */
  async delete(key: string): Promise<void> {
    this.ensureLoaded();
    if (key in this.memoryCache!) {
      delete this.memoryCache![key];
      await this.saveData(this.memoryCache!);
    }
  }

  // --- Helpers ---

  private ensureLoaded(): void {
    if (this.memoryCache === null) {
      throw new OpalError('Store is not loaded. Call await store.load() first.', 'OPAL_NOT_LOADED');
    }
  }

  /**
   * Atomic Write Strategy: Write to tmp -> Rename
   * Prevents corruption if process crashes during write.
   */
  private async saveData(data: Record<string, unknown>): Promise<void> {
    const key = await this.getMasterKey();
    const jsonStr = JSON.stringify(data);
    const payload = Cipher.encrypt(jsonStr, key, this.options.appName);

    const dir = path.dirname(this.filePath);
    const tempPath = `${this.filePath}.${randomBytes(4).toString('hex')}.tmp`;

    await fs.mkdir(dir, { recursive: true });

    try {
      await fs.writeFile(tempPath, JSON.stringify(payload, null, 2));
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => { });
      throw error;
    }
  }
}

// Re-export for convenience
export { Cipher, EncryptedPayload } from './cipher.js';
