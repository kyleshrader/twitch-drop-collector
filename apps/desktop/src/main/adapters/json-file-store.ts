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
      await rename(temp, file)
    }
  }
}
