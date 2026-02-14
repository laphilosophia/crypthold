import { AsyncEntry } from '@napi-rs/keyring'
import { randomBytes } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Cipher } from './cipher.js'
import type { EncryptedPayload, OpalV1File } from './cipher.types.js'

const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

interface FileSnapshot {
  mtimeMs: number
  size: number
}

export interface OpalOptions {
  /** Application name, used for keychain service and AAD context */
  appName: string
  /** Custom path for encrypted config file */
  configPath?: string
  /** Environment variable name containing master key (for CI/CD) */
  encryptionKeyEnvVar?: string
  /** Maximum encrypted file size (in bytes) before load aborts */
  maxFileSizeBytes?: number
  /** Key identifier for header metadata */
  keyId?: string
}

export class OpalError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
    this.name = 'OpalError'
  }
}

export class Opal {
  private filePath: string
  private options: OpalOptions

  // State Guard: null indicates not loaded
  private memoryCache: Record<string, unknown> | null = null
  private fileSnapshot: FileSnapshot | null = null

  constructor(options: OpalOptions) {
    if (!options.appName) {
      throw new Error('Opal: appName is required')
    }

    this.options = options

    const homeDir = process.env.HOME || process.env.USERPROFILE || '.'
    this.filePath =
      options.configPath || path.join(homeDir, '.config', options.appName, 'store.enc')
  }

  /**
   * Initializes a new store. Throws OPAL_ALREADY_INIT if key exists.
   */
  async init(): Promise<void> {
    try {
      await this.getMasterKey()
      throw new OpalError('Store already initialized. Use load() instead.', 'OPAL_ALREADY_INIT')
    } catch (e: unknown) {
      if (e instanceof OpalError && e.code === 'OPAL_KEY_NOT_FOUND') {
        const newKey = randomBytes(32).toString('hex')
        const entry = new AsyncEntry(this.options.appName, 'default')
        await entry.setPassword(newKey)
        this.memoryCache = {}
        await this.saveData({})
        return
      }
      throw e
    }
  }

  /**
   * Loads existing store. Throws OPAL_KEY_NOT_FOUND if no key exists.
   */
  async load(): Promise<void> {
    const key = await this.getMasterKey()

    try {
      await this.assertWithinMaxSize()

      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown

      let decryptedJson: string
      let needsMigration = false

      if (this.isV1File(parsed)) {
        const encKey = Cipher.deriveEncryptionKey(key, Buffer.from(parsed.header.salt, 'hex'))
        decryptedJson = this.decryptWithIntegrityNormalization(parsed.payload, encKey)
      } else {
        const legacyPayload = parsed as EncryptedPayload
        decryptedJson = this.decryptWithIntegrityNormalization(legacyPayload, key)
        needsMigration = true
      }

      this.memoryCache = JSON.parse(decryptedJson)
      this.fileSnapshot = await this.readFileSnapshot()

      if (needsMigration) {
        await this.saveData(this.memoryCache as Record<string, unknown>)
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.memoryCache = {}
        this.fileSnapshot = null
        return
      }
      if (error instanceof OpalError) {
        throw error
      }

      throw new OpalError('Failed to verify encrypted store integrity.', 'OPAL_INTEGRITY_FAIL')
    }
  }

  private async getMasterKey(): Promise<Buffer> {
    let keyHex: string | null = null

    if (this.options.encryptionKeyEnvVar && process.env[this.options.encryptionKeyEnvVar]) {
      keyHex = process.env[this.options.encryptionKeyEnvVar]!
    } else {
      const entry = new AsyncEntry(this.options.appName, 'default')
      keyHex = (await entry.getPassword()) ?? null
    }

    if (!keyHex) {
      throw new OpalError(
        `Master key not found for service: ${this.options.appName}. Run 'init()' first.`,
        'OPAL_KEY_NOT_FOUND',
      )
    }

    const keyBuffer = Buffer.from(keyHex, 'hex')
    // 32 bytes = 256 bits (AES-256 requirement)
    if (keyBuffer.length !== 32) {
      throw new OpalError(
        'Invalid master key length. Key must be 64 hex characters (32 bytes).',
        'OPAL_INVALID_KEY',
      )
    }

    return keyBuffer
  }

  // --- Public API ---

  /**
   * Sets a value and persists immediately.
   */
  async set(key: string, value: unknown): Promise<void> {
    this.ensureLoaded()
    this.memoryCache![key] = value
    await this.saveData(this.memoryCache!)
  }

  /**
   * Retrieves a specific value by key.
   */
  get<T>(key: string): T | null {
    this.ensureLoaded()
    if (key in this.memoryCache!) {
      return this.memoryCache![key] as T
    }
    return null
  }

  /**
   * Retrieves all configuration data.
   * Returns a shallow copy to prevent internal cache mutation.
   */
  getAll(): Record<string, unknown> {
    this.ensureLoaded()
    return { ...this.memoryCache! }
  }

  /**
   * Deletes a key and persists immediately.
   */
  async delete(key: string): Promise<void> {
    this.ensureLoaded()
    if (key in this.memoryCache!) {
      delete this.memoryCache![key]
      await this.saveData(this.memoryCache!)
    }
  }

  // --- Helpers ---

  private ensureLoaded(): void {
    if (this.memoryCache === null) {
      throw new OpalError('Store is not loaded. Call await store.load() first.', 'OPAL_NOT_LOADED')
    }
  }

  private decryptWithIntegrityNormalization(payload: EncryptedPayload, key: Buffer): string {
    try {
      return Cipher.decrypt(payload, key, this.options.appName)
    } catch {
      throw new OpalError('Failed to verify encrypted store integrity.', 'OPAL_INTEGRITY_FAIL')
    }
  }

  private async assertWithinMaxSize(): Promise<void> {
    const maxFileSize = this.options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES
    const stat = await fs.stat(this.filePath)

    if (stat.size > maxFileSize) {
      throw new OpalError(
        `Encrypted store exceeds maximum allowed size (${maxFileSize} bytes).`,
        'OPAL_FILE_TOO_LARGE',
      )
    }
  }

  private async readFileSnapshot(): Promise<FileSnapshot | null> {
    try {
      const stat = await fs.stat(this.filePath)
      return { mtimeMs: stat.mtimeMs, size: stat.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  private async assertUnchangedSinceSnapshot(): Promise<void> {
    const current = await this.readFileSnapshot()

    if (this.fileSnapshot === null && current === null) {
      return
    }

    if (this.fileSnapshot === null || current === null) {
      throw new OpalError('Encrypted store changed since last load.', 'OPAL_CONFLICT')
    }

    if (this.fileSnapshot.mtimeMs !== current.mtimeMs || this.fileSnapshot.size !== current.size) {
      throw new OpalError('Encrypted store changed since last load.', 'OPAL_CONFLICT')
    }
  }

  private isV1File(data: unknown): data is OpalV1File {
    if (!data || typeof data !== 'object') {
      return false
    }

    const file = data as Partial<OpalV1File>

    return (
      !!file.header &&
      file.header.v === 1 &&
      file.header.kdf === 'HKDF-SHA256' &&
      typeof file.header.salt === 'string' &&
      typeof file.header.keyId === 'string' &&
      !!file.payload
    )
  }

  private getWritableMode(existingMode?: number): number {
    if (process.platform === 'win32') {
      return 0o600
    }

    if (existingMode === undefined) {
      return 0o600
    }

    return existingMode & 0o600
  }

  /**
   * Atomic Write Strategy: Write to tmp -> Rename
   * Prevents corruption if process crashes during write.
   */
  private async saveData(data: Record<string, unknown>): Promise<void> {
    const key = await this.getMasterKey()
    await this.assertUnchangedSinceSnapshot()
    const jsonStr = JSON.stringify(data)
    const salt = Cipher.generateSalt()
    const encKey = Cipher.deriveEncryptionKey(key, salt)

    const fileData: OpalV1File = {
      header: {
        v: 1,
        kdf: 'HKDF-SHA256',
        salt: salt.toString('hex'),
        keyId: this.options.keyId ?? 'default',
      },
      payload: Cipher.encrypt(jsonStr, encKey, this.options.appName),
    }

    const dir = path.dirname(this.filePath)
    const tempPath = `${this.filePath}.${randomBytes(4).toString('hex')}.tmp`

    await fs.mkdir(dir, { recursive: true })

    let existingMode: number | undefined
    try {
      existingMode = (await fs.stat(this.filePath)).mode
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    try {
      await fs.writeFile(tempPath, JSON.stringify(fileData, null, 2), {
        mode: this.getWritableMode(existingMode),
      })
      await fs.rename(tempPath, this.filePath)
      this.fileSnapshot = await this.readFileSnapshot()
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {})
      throw error
    }
  }
}

// Re-export for convenience
export { Cipher } from './cipher.js'
export type { EncryptedPayload, OpalV1File } from './cipher.types.js'
