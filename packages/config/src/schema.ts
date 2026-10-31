// User settings: one zod schema per section, the defaults, and the patch shape for updates.
import { z } from 'zod'

export const SETTINGS_VERSION = 1

export const PRIORITY_MODES = ['priorityOnly', 'endingSoonest', 'lowAvailabilityFirst'] as const
export const THEMES = ['system', 'light', 'dark'] as const
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const

const GameNames = z.array(z.string().trim().min(1).max(200)).max(500)

export const GeneralSettings = z.object({
  launchAtLogin: z.boolean(),
  /** When launched at login, start in the tray instead of showing the window. */
  startMinimized: z.boolean(),
  /** Closing the window hides it to the tray and keeps mining; Quit is in the tray menu. */
  closeToTray: z.boolean(),
  trayNotifications: z.boolean(),
  theme: z.enum(THEMES),
  /** Consent to keep crash dumps (on this computer only). Off until the user turns it on. */
  crashReports: z.boolean()
})

export const MiningSettings = z.object({
  /** Game names in priority order. */
  priority: GameNames,
  /** Game names never mined. */
  exclude: GameNames,
  priorityMode: z.enum(PRIORITY_MODES),
  /** Mine campaigns whose rewards are badges or emotes (they need no account link). */
  enableBadgesEmotes: z.boolean(),
  /** Double-check that a channel really has drops enabled before watching it. */
  availableDropsCheck: z.boolean()
})

export const NetworkSettings = z.object({
  /** Empty string for no proxy. */
  proxy: z.union([z.literal(''), z.url({ protocol: /^(https?|socks5?)$/ })]),
  /** 1 (fast) to 6 (slow); scales request timeouts. */
  connectionQuality: z.number().int().min(1).max(6)
})

export const LoggingSettings = z.object({
  level: z.enum(LOG_LEVELS)
})

export const Settings = z.object({
  general: GeneralSettings,
  mining: MiningSettings,
  network: NetworkSettings,
  logging: LoggingSettings
})
export type Settings = z.infer<typeof Settings>
export type SettingsSection = keyof Settings

export const DEFAULT_SETTINGS: Settings = {
  general: {
    launchAtLogin: false,
    startMinimized: false,
    closeToTray: true,
    trayNotifications: true,
    theme: 'system',
    crashReports: false
  },
  mining: {
    priority: [],
    exclude: [],
    priorityMode: 'priorityOnly',
    enableBadgesEmotes: false,
    availableDropsCheck: false
  },
  network: {
    proxy: '',
    connectionQuality: 1
  },
  logging: {
    level: 'info'
  }
}

/** A partial update: any subset of fields in any subset of sections. Unknown keys are rejected. */
export const SettingsPatch = z.strictObject({
  general: z.strictObject(GeneralSettings.partial().shape).optional(),
  mining: z.strictObject(MiningSettings.partial().shape).optional(),
  network: z.strictObject(NetworkSettings.partial().shape).optional(),
  logging: z.strictObject(LoggingSettings.partial().shape).optional()
})
export type SettingsPatch = z.infer<typeof SettingsPatch>
