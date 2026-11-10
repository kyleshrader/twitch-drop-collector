// User settings: one zod schema per section, the defaults, and the patch shape for updates.
import { z } from 'zod'

export const SETTINGS_VERSION = 1

export const PRIORITY_MODES = ['priorityOnly', 'endingSoonest', 'lowAvailabilityFirst'] as const
export const THEMES = ['system', 'light', 'dark'] as const
/** Which window UI to show: the current one, or the new one while it's being built. */
export const UI_CHOICES = ['classic', 'next'] as const
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
  crashReports: z.boolean(),
  /** The window's UI: classic, or the new one in preview (switchable from both). */
  ui: z.enum(UI_CHOICES)
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

/**
 * auto: download updates in the background and install them on quit (or on Restart now).
 * notify: say an update is out, and download it only when asked.
 * off: never check by itself; Check for updates still works.
 */
export const UPDATE_MODES = ['auto', 'notify', 'off'] as const
/** A release version, as the update feed names it. */
const Version = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)

export const UpdateSettings = z.object({
  mode: z.enum(UPDATE_MODES),
  /** Offer pre-release versions too. */
  prereleases: z.boolean(),
  /** A version the user chose to skip; automatic checks don't offer it. Empty for none. */
  skippedVersion: z.union([z.literal(''), Version])
})

/** How the new UI's Drops page groups Up next into cards (docs/new-ui/queue-rules.md). */
export const QUEUE_LAYOUTS = ['games', 'campaigns'] as const
export const QUEUE_SORTS = ['priority', 'ending', 'spare', 'custom'] as const
export const QUEUE_AUTO_SORTS = ['priority', 'ending', 'spare'] as const
export const NEW_IN_CUSTOM_RULES = ['byTimeRemaining', 'end'] as const

const CampaignId = z.string().min(1).max(100)

/**
 * The Up next queue: how it's shown and sorted, and the user's own order. What Twitch does with
 * watch time is settled (Twitch's Drops campaign guide), so it's fixed in @tdc/core, not a setting.
 */
export const QueueSettings = z.object({
  layout: z.enum(QUEUE_LAYOUTS),
  sort: z.enum(QUEUE_SORTS),
  /** The automatic sort a custom order started from ("Reset to …"). */
  baseSort: z.enum(QUEUE_AUTO_SORTS),
  /** Campaign IDs in the user's order; used when sort is custom. */
  order: z.array(CampaignId).max(2000),
  /** Collect now in an automatic sort: this campaign goes first until it's done. Empty: none. */
  focus: z.union([z.literal(''), CampaignId]),
  /** Mining paused by the user (survives restarts). */
  paused: z.boolean(),
  /** In the automatic sorts, linked games before games that need linking. */
  linkedFirst: z.boolean(),
  newInCustom: z.enum(NEW_IN_CUSTOM_RULES)
})
export type QueueSettings = z.infer<typeof QueueSettings>

export const Settings = z.object({
  general: GeneralSettings,
  mining: MiningSettings,
  network: NetworkSettings,
  logging: LoggingSettings,
  updates: UpdateSettings,
  queue: QueueSettings
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
    crashReports: false,
    ui: 'classic'
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
  },
  updates: {
    mode: 'notify',
    prereleases: false,
    skippedVersion: ''
  },
  queue: {
    layout: 'games',
    sort: 'priority',
    baseSort: 'priority',
    order: [],
    focus: '',
    paused: false,
    linkedFirst: true,
    newInCustom: 'byTimeRemaining'
  }
}

/** A partial update: any subset of fields in any subset of sections. Unknown keys are rejected. */
export const SettingsPatch = z.strictObject({
  general: z.strictObject(GeneralSettings.partial().shape).optional(),
  mining: z.strictObject(MiningSettings.partial().shape).optional(),
  network: z.strictObject(NetworkSettings.partial().shape).optional(),
  logging: z.strictObject(LoggingSettings.partial().shape).optional(),
  updates: z.strictObject(UpdateSettings.partial().shape).optional(),
  queue: z.strictObject(QueueSettings.partial().shape).optional()
})
export type SettingsPatch = z.infer<typeof SettingsPatch>
