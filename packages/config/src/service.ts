import type { Logger } from '@tdc/kernel'
import { SettingsPatch, type Settings } from './schema'
import { loadSettingsFile, toSettingsFile } from './stored'

/** Persistence for the settings file. Implemented in apps/desktop (a JSON file in userData). */
export interface SettingsStore {
  /** The parsed file contents, or undefined when there is no file yet. */
  read(): Promise<unknown>
  write(data: unknown): Promise<void>
}

export type SettingsListener = (next: Settings, previous: Settings) => void

export interface SettingsService {
  get(): Settings
  /** Validates and applies a partial update, persists it, then notifies subscribers. */
  update(patch: SettingsPatch): Promise<Settings>
  subscribe(listener: SettingsListener): () => void
}

function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  return {
    general: { ...current.general, ...patch.general },
    mining: { ...current.mining, ...patch.mining },
    network: { ...current.network, ...patch.network },
    logging: { ...current.logging, ...patch.logging }
  }
}

export async function createSettingsService(deps: {
  store: SettingsStore
  logger: Logger
}): Promise<SettingsService> {
  const { store, logger } = deps
  const loaded = loadSettingsFile(await store.read())
  for (const problem of loaded.problems) logger.warn(problem)

  let current = loaded.settings
  const listeners = new Set<SettingsListener>()
  // Writes run one at a time, in call order, so the file always ends with the latest settings.
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  if (loaded.problems.length > 0) {
    // Rewrite the repaired file so the same warnings don't repeat on every launch.
    await enqueue(() => store.write(toSettingsFile(current)))
  }

  return {
    get: () => current,
    update: (patch) =>
      enqueue(async () => {
        const next = applyPatch(current, SettingsPatch.parse(patch))
        if (JSON.stringify(next) === JSON.stringify(current)) return current
        await store.write(toSettingsFile(next))
        const previous = current
        current = next
        for (const listener of listeners) {
          try {
            listener(next, previous)
          } catch (error) {
            logger.error('Settings listener failed', { error })
          }
        }
        return next
      }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
