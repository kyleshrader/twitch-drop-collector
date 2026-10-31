// Transport copy of @tdc/config's settings schema. ipc-contract may depend only on zod (rule 7),
// so it can't import config. apps/desktop/src/main/ipc/settings-contract.test.ts fails the
// typecheck if the two ever drift apart.
import { z } from 'zod'

const GameNames = z.array(z.string().trim().min(1).max(200)).max(500)

const General = z.object({
  launchAtLogin: z.boolean(),
  startMinimized: z.boolean(),
  closeToTray: z.boolean(),
  trayNotifications: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
  crashReports: z.boolean()
})

const Mining = z.object({
  priority: GameNames,
  exclude: GameNames,
  priorityMode: z.enum(['priorityOnly', 'endingSoonest', 'lowAvailabilityFirst']),
  enableBadgesEmotes: z.boolean(),
  availableDropsCheck: z.boolean()
})

const Network = z.object({
  proxy: z.union([z.literal(''), z.url({ protocol: /^(https?|socks5?)$/ })]),
  connectionQuality: z.number().int().min(1).max(6)
})

const Logging = z.object({
  level: z.enum(['error', 'warn', 'info', 'debug'])
})

const Updates = z.object({
  mode: z.enum(['auto', 'notify', 'off']),
  prereleases: z.boolean(),
  skippedVersion: z.union([z.literal(''), z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)])
})

export const SettingsView = z.object({
  general: General,
  mining: Mining,
  network: Network,
  logging: Logging,
  updates: Updates
})
export type SettingsView = z.infer<typeof SettingsView>

export const SettingsPatchInput = z.strictObject({
  general: z.strictObject(General.partial().shape).optional(),
  mining: z.strictObject(Mining.partial().shape).optional(),
  network: z.strictObject(Network.partial().shape).optional(),
  logging: z.strictObject(Logging.partial().shape).optional(),
  updates: z.strictObject(Updates.partial().shape).optional()
})
export type SettingsPatchInput = z.infer<typeof SettingsPatchInput>
