// The Twitch session, encrypted with Electron's safeStorage (DPAPI on Windows, Keychain on macOS,
// the desktop keyring on Linux) and written under userData. Without a real keyring on Linux,
// safeStorage falls back to a hard-coded key ("basic_text"), so we keep the session in memory
// only and the user signs in each launch (spec fallback; see docs/decisions.md).
// Uses the async safeStorage API; the sync one is deprecated as of Electron 45.
import type { SafeStorage } from 'electron'
import type { SessionStore, StoredSession } from '@tdc/core'
import type { Logger } from '@tdc/kernel'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

type AsyncSafeStorage = Pick<
  SafeStorage,
  | 'isAsyncEncryptionAvailable'
  | 'getSelectedStorageBackend'
  | 'encryptStringAsync'
  | 'decryptStringAsync'
>

const Stored = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  userId: z.string(),
  login: z.string(),
  clientId: z.string(),
  deviceId: z.string()
})

export async function canPersistSecrets(
  safeStorage: Pick<SafeStorage, 'isAsyncEncryptionAvailable' | 'getSelectedStorageBackend'>,
  platform: NodeJS.Platform
): Promise<boolean> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
  return platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

/** Must be called after the app is ready (safeStorage needs it). */
export async function createSafeStorageSessionStore(deps: {
  safeStorage: AsyncSafeStorage
  platform: NodeJS.Platform
  file: string
  logger: Logger
}): Promise<SessionStore> {
  const { safeStorage, platform, file, logger } = deps
  const persistent = await canPersistSecrets(safeStorage, platform)
  if (!persistent) {
    logger.warn('No secure storage available; you will need to sign in each time the app starts', {
      ...(platform === 'linux' ? { backend: safeStorage.getSelectedStorageBackend() } : {})
    })
  }
  let memory: StoredSession | undefined

  const writeEncrypted = async (session: StoredSession): Promise<void> => {
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    await writeFile(temp, await safeStorage.encryptStringAsync(JSON.stringify(session)))
    await rename(temp, file)
  }

  return {
    persistent,
    async read() {
      if (!persistent) return memory
      let encrypted: Buffer
      try {
        encrypted = await readFile(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted)
        const parsed = Stored.safeParse(JSON.parse(result))
        if (parsed.success) {
          // The OS key was rotated or upgraded: save again under the new key.
          if (shouldReEncrypt) await writeEncrypted(parsed.data)
          return parsed.data
        }
        logger.warn('Saved session has an unexpected format; discarding it')
      } catch {
        // Encrypted by another user or machine, or damaged.
        logger.warn('Saved session could not be decrypted; discarding it')
      }
      await rm(file, { force: true })
      return undefined
    },
    async write(session) {
      if (!persistent) {
        memory = session
        return
      }
      await writeEncrypted(session)
    },
    async clear() {
      memory = undefined
      await rm(file, { force: true })
    }
  }
}
