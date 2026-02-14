import * as fs from 'fs/promises'
import * as path from 'path'
import {
  DEFAULT_LOCK_RETRY_INTERVAL_MS,
  DEFAULT_LOCK_STALE_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
} from './constants.js'
import type { AcquireLockOptions, LockManagerConfig, LockMeta } from './types.js'

export class LockManager {
  private filePath: string
  private nowMs: () => number

  constructor(config: LockManagerConfig) {
    this.filePath = config.filePath
    this.nowMs = config.nowMs
  }

  getLockPath(): string {
    return `${this.filePath}.lock`
  }

  async readLockMeta(): Promise<LockMeta | null> {
    try {
      const raw = await fs.readFile(this.getLockPath(), 'utf-8')
      const parsed = JSON.parse(raw) as LockMeta
      return parsed
    } catch {
      return null
    }
  }

  async acquireLock(options: AcquireLockOptions): Promise<() => Promise<void>> {
    const lockPath = this.getLockPath()
    await fs.mkdir(path.dirname(lockPath), { recursive: true })

    const startedAt = this.nowMs()
    const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS
    const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
    const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_INTERVAL_MS

    while (true) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, ts: this.nowMs() }))
        } finally {
          await handle.close()
        }

        return async () => {
          try {
            await fs.unlink(lockPath)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error
        }

        const meta = await this.readLockMeta()
        const lockTs = meta?.ts

        if (typeof lockTs === 'number' && this.nowMs() - lockTs > staleMs) {
          await fs.unlink(lockPath).catch(() => {})
          continue
        }

        if (this.nowMs() - startedAt >= timeoutMs) {
          throw options.onTimeout()
        }

        await this.sleep(retryMs)
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}
