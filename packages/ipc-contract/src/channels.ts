// Every renderer → main request channel, defined once with its input and output schemas.
// Main validates input before calling a handler and validates output before replying.
import { z } from 'zod'
import { AuthStateView, SignInMethod } from './auth'
import { MinerView, SelectChannelInput } from './miner'
import { SettingsPatchInput, SettingsView } from './settings'

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string()
})
export type AppInfo = z.infer<typeof AppInfo>

export const OpenExternalInput = z.object({
  url: z.url({ protocol: /^https$/ })
})
export type OpenExternalInput = z.infer<typeof OpenExternalInput>

export const invokeChannels = {
  'app:getInfo': { input: z.undefined(), output: AppInfo },
  /** Opens the folder with the log files (and crash dumps, when on) in the file manager. */
  'app:openLogsFolder': { input: z.undefined(), output: z.object({ opened: z.boolean() }) },
  'shell:openExternal': { input: OpenExternalInput, output: z.object({ opened: z.boolean() }) },
  'settings:get': { input: z.undefined(), output: SettingsView },
  'settings:update': { input: SettingsPatchInput, output: SettingsView },
  'auth:getState': { input: z.undefined(), output: AuthStateView },
  /** Starts signing in; progress shows up in auth:getState. */
  'auth:signIn': {
    input: z.object({ method: SignInMethod }),
    output: z.object({ started: z.literal(true) })
  },
  'auth:cancelSignIn': { input: z.undefined(), output: AuthStateView },
  'auth:signOut': { input: z.undefined(), output: AuthStateView },
  'miner:getState': { input: z.undefined(), output: MinerView },
  'miner:reload': { input: z.undefined(), output: z.object({ queued: z.literal(true) }) },
  /** Watch this channel while it's watchable; no channelId lets the miner choose. */
  'miner:selectChannel': {
    input: SelectChannelInput,
    output: z.object({ queued: z.literal(true) })
  }
} as const satisfies Record<string, { input: z.ZodType; output: z.ZodType }>

export type InvokeChannel = keyof typeof invokeChannels
export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeChannels)[C]['input']>
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeChannels)[C]['output']>

/** Channels without input take no argument: invoke('app:getInfo'). */
export type InvokeArgs<C extends InvokeChannel> =
  InvokeInput<C> extends undefined ? [] : [input: InvokeInput<C>]

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && Object.hasOwn(invokeChannels, value)
}
