// SettingsStore backed by one JSON file. Writes go to a temp file first and are renamed into
// place, so a crash mid-write never leaves a half-written settings file.
import type { SettingsStore } from '@tdc/config'
import type { Logger } from '@tdc/kernel'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export function createJsonFileStore(deps: {
  file: string
  logger: Logger
  now?: () => Date
}): SettingsStore {
  const { file, logger, now = (): Date => new Date() } = deps

  return {
    async read(): Promise<unknown> {
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch (error) {
        if (isMissing(error)) return undefined
        throw error
      }
      try {
        return JSON.parse(text) as unknown
      } catch {
        // Keep the unreadable file for inspection and start over from defaults.
        const backup = `${file}.corrupt-${now().toISOString().replace(/[:.]/g, '-')}`
        await rename(file, backup)
        logger.warn('Settings file was not valid JSON; moved it aside and using defaults', {
          backup
        })
        return undefined
      }
    },
    async write(data): Promise<void> {
      await mkdir(dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      await renameWithRetry(temp, file)
    }
  }
}

/** Windows refuses a rename for a moment while another process (a virus scanner, the indexer,
 * a reader) has the file open. Those errors pass quickly, so retry briefly before failing. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])
export async function renameWithRetry(
  from: string,
  to: string,
  options: { attempts?: number; delayMs?: number; rename?: typeof rename } = {}
): Promise<void> {
  const { attempts = 6, delayMs = 25, rename: move = rename } = options
  for (let attempt = 1; ; attempt++) {
    try {
      await move(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (attempt >= attempts || !code || !BUSY.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
    }
  }
}
