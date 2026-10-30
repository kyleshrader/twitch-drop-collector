// Reading the settings file: migrate old versions, then keep every valid value and fall back to
// the default for anything missing or invalid, so one bad field never wipes the user's settings.
import { DEFAULT_SETTINGS, SETTINGS_VERSION, Settings, type SettingsSection } from './schema'

export interface SettingsFile {
  version: number
  settings: Settings
}

type Migration = (settings: Record<string, unknown>) => Record<string, unknown>

/** MIGRATIONS[n] upgrades a version-n file to version n + 1. */
const MIGRATIONS: Record<number, Migration> = {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function migrate(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  targetVersion: number = SETTINGS_VERSION
): { settings: unknown; problems: string[] } {
  if (!isRecord(raw)) return { settings: undefined, problems: ['settings file is not an object'] }
  const problems: string[] = []
  const rawVersion = raw['version']
  let settings = raw['settings']
  let version = targetVersion
  if (typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 1) {
    version = rawVersion
  } else {
    problems.push(`unknown settings version ${JSON.stringify(rawVersion)}; reading as current`)
  }
  if (version > targetVersion) {
    problems.push(`settings file is from a newer version (${version}); unknown fields are dropped`)
  }
  for (let v = version; v < targetVersion; v++) {
    const step = migrations[v]
    if (!step || !isRecord(settings)) {
      problems.push(`no migration from version ${v}; reading as current`)
      break
    }
    settings = step(settings)
  }
  return { settings, problems }
}

export function parseSettings(raw: unknown): { settings: Settings; problems: string[] } {
  const problems: string[] = []
  const source = isRecord(raw) ? raw : {}
  const result: Record<string, Record<string, unknown>> = {}

  for (const section of Object.keys(DEFAULT_SETTINGS) as SettingsSection[]) {
    const shape = Settings.shape[section].shape as Record<
      string,
      { safeParse(v: unknown): { success: boolean; data?: unknown } }
    >
    const defaults = DEFAULT_SETTINGS[section] as Record<string, unknown>
    const stored = source[section]
    const values: Record<string, unknown> = {}
    for (const key of Object.keys(shape)) {
      const value = isRecord(stored) ? stored[key] : undefined
      if (value === undefined) {
        values[key] = defaults[key]
        continue
      }
      const parsed = shape[key]!.safeParse(value)
      if (parsed.success) {
        values[key] = parsed.data
      } else {
        values[key] = defaults[key]
        problems.push(`${section}.${key} was invalid and has been reset to its default`)
      }
    }
    result[section] = values
  }
  return { settings: Settings.parse(result), problems }
}

/** Turns whatever the store returned into valid settings, reporting anything it had to repair. */
export function loadSettingsFile(raw: unknown): { settings: Settings; problems: string[] } {
  if (raw === undefined) return { settings: DEFAULT_SETTINGS, problems: [] }
  const migrated = migrate(raw)
  const parsed = parseSettings(migrated.settings)
  return { settings: parsed.settings, problems: [...migrated.problems, ...parsed.problems] }
}

export function toSettingsFile(settings: Settings): SettingsFile {
  return { version: SETTINGS_VERSION, settings }
}
