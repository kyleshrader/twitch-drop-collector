// Every renderer → main request channel, defined once with its input and output schemas.
// Main validates input before calling a handler and validates output before replying.
import { z } from 'zod'
import {
  ApiCheckInput,
  ApiCheckResult,
  ApiIssuesView,
  DismissApiIssueInput,
  ReportApiIssueInput
} from './api-issues'
import { AuthStateView, SignInMethod } from './auth'
import { GameSearchResult, SearchGamesInput } from './games'
import { HistoryView } from './history'
import { MinerView, SelectChannelInput } from './miner'
import { SettingsPatchInput, SettingsView } from './settings'
import { UpdateView } from './updates'

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
  },
  /** Twitch games whose name matches, best match first. Empty while signed out. */
  'games:search': { input: SearchGamesInput, output: z.array(GameSearchResult) },
  'apiIssues:getState': { input: z.undefined(), output: ApiIssuesView },
  /** Hides an issue (or all of them) until it happens again a day or more later. */
  'apiIssues:dismiss': { input: DismissApiIssueInput, output: ApiIssuesView },
  /** Opens a new GitHub issue in the browser, filled in with the redacted details. */
  'apiIssues:report': { input: ReportApiIssueInput, output: z.object({ opened: z.boolean() }) },
  /** Runs the read-only Twitch requests now; mismatches are recorded as issues. */
  'apiIssues:check': { input: ApiCheckInput, output: ApiCheckResult },
  /** The read-only requests Test calls can run (empty while signed out). */
  'apiIssues:calls': { input: z.undefined(), output: z.array(z.string()) },
  /** Records a made-up mismatch, as Twitch changing a response would, to try the page. */
  'apiIssues:demo': { input: z.undefined(), output: ApiIssuesView },
  /** The History page's timeline, from the local database. */
  'history:get': { input: z.undefined(), output: HistoryView },
  'updates:getState': { input: z.undefined(), output: UpdateView },
  /** Checks now, whatever the update mode; offers a skipped version too. */
  'updates:check': { input: z.undefined(), output: UpdateView },
  /** Downloads the available version; progress shows up in updates:getState. */
  'updates:download': { input: z.undefined(), output: UpdateView },
  /** Quits and installs the downloaded version, then starts it again. */
  'updates:install': { input: z.undefined(), output: z.object({ installing: z.boolean() }) },
  /** Later: hides the offer for this version until the app starts again. */
  'updates:dismiss': { input: z.undefined(), output: UpdateView },
  /** Skip this version: automatic checks stop offering it (saved in settings). */
  'updates:skip': { input: z.undefined(), output: UpdateView }
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
