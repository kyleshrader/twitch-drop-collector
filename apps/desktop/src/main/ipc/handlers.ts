import type { App, Shell } from 'electron'
import type { SettingsService } from '@tdc/config'
import type { AuthService } from '@tdc/core'
import type {
  ApiCheckResult,
  ApiIssuesView,
  AppInfo,
  AuthStateView,
  CampaignView,
  GameSearchResult,
  HistoryView,
  MinerView,
  SettingsView,
  UpdateView
} from '@tdc/ipc-contract'
import type { ApiIssueLog } from '../api-issues/api-issues'
import { demoIssue } from '../api-issues/demo'
import { reportUrl } from '../api-issues/report'
import type { ApiCallOutcome } from '../miner/runtime'
import { isSafeExternalUrl } from '../policy'
import type { Updater } from '../updates/updater'
import type { InvokeHandlers } from './router'

export function createInvokeHandlers(deps: {
  app: Pick<App, 'getName' | 'getVersion'>
  shell: Pick<Shell, 'openExternal' | 'openPath'>
  platform: string
  logsFolder: string
  settings: Pick<SettingsService, 'get' | 'update'>
  auth: Pick<AuthService, 'state' | 'signIn' | 'cancelSignIn' | 'signOut'>
  miner: {
    view(): MinerView
    reload(): void
    selectChannel(channelId: string | undefined): void
    searchGames(query: string): Promise<GameSearchResult[]>
    apiCalls(): string[]
    checkApi(only?: string): Promise<ApiCallOutcome[]>
    history(): HistoryView
    pastCampaigns(): CampaignView[]
  }
  apiIssues: Pick<ApiIssueLog, 'view' | 'get' | 'dismiss' | 'report'>
  /** Redacts what Test calls show (api-issues/redact.ts). */
  redact: (value: unknown) => unknown
  updates: Pick<Updater, 'view' | 'check' | 'download' | 'install' | 'dismiss' | 'skip'>
}): InvokeHandlers {
  const { app, shell, platform, settings, auth, miner, updates, apiIssues } = deps
  return {
    'app:getInfo': (): AppInfo => ({ name: app.getName(), version: app.getVersion(), platform }),
    // A fixed folder chosen by main; the renderer can't name a path.
    'app:openLogsFolder': async (): Promise<{ opened: boolean }> => ({
      opened: (await shell.openPath(deps.logsFolder)) === ''
    }),
    'shell:openExternal': async ({ url }): Promise<{ opened: boolean }> => {
      // The schema already requires https; this keeps main's own rule authoritative.
      if (!isSafeExternalUrl(url)) return { opened: false }
      await shell.openExternal(url)
      return { opened: true }
    },
    // The transport and config schemas are the same shape (checked by settings-contract.test.ts).
    'settings:get': (): SettingsView => settings.get(),
    'settings:update': (patch): Promise<SettingsView> => settings.update(patch),
    // AuthState carries no token, and the output schema strips anything it doesn't declare.
    'auth:getState': (): AuthStateView => auth.state(),
    'auth:signIn': ({ method }): { started: true } => {
      void auth.signIn(method)
      return { started: true }
    },
    'auth:cancelSignIn': (): AuthStateView => {
      auth.cancelSignIn()
      return auth.state()
    },
    'auth:signOut': async (): Promise<AuthStateView> => {
      await auth.signOut()
      return auth.state()
    },
    'miner:getState': (): MinerView => miner.view(),
    'miner:reload': (): { queued: true } => {
      miner.reload()
      return { queued: true }
    },
    'miner:selectChannel': ({ channelId }): { queued: true } => {
      miner.selectChannel(channelId)
      return { queued: true }
    },
    'games:search': ({ query }): Promise<GameSearchResult[]> => miner.searchGames(query),
    'apiIssues:getState': (): ApiIssuesView => apiIssues.view(),
    'apiIssues:dismiss': ({ id }): ApiIssuesView => {
      apiIssues.dismiss(id)
      return apiIssues.view()
    },
    // Main builds the link from its own redacted copy; the renderer only names the issue.
    'apiIssues:report': async ({ id }): Promise<{ opened: boolean }> => {
      const issue = apiIssues.get(id)
      if (!issue) return { opened: false }
      await shell.openExternal(reportUrl(issue, { version: app.getVersion(), platform }))
      return { opened: true }
    },
    'apiIssues:check': async ({ endpoint }): Promise<ApiCheckResult> => {
      const outcomes = await miner.checkApi(endpoint)
      return {
        results: outcomes.map(({ response, ...outcome }) => ({
          ...outcome,
          ...(outcome.error ? { error: String(deps.redact(outcome.error)) } : {}),
          ...(response !== undefined ? { response: deps.redact(response) } : {})
        })),
        issues: apiIssues.view()
      }
    },
    'apiIssues:calls': (): string[] => miner.apiCalls(),
    'apiIssues:demo': (): ApiIssuesView => {
      apiIssues.report(demoIssue())
      return apiIssues.view()
    },
    'history:get': (): HistoryView => miner.history(),
    'library:pastCampaigns': (): CampaignView[] => miner.pastCampaigns(),
    'updates:getState': (): UpdateView => updates.view(),
    'updates:check': (): Promise<UpdateView> => updates.check({ manual: true }),
    // Returns once the download starts; progress and the ready state arrive as events.
    'updates:download': (): UpdateView => {
      void updates.download()
      return updates.view()
    },
    'updates:install': (): { installing: boolean } => ({ installing: updates.install() }),
    'updates:dismiss': (): UpdateView => updates.dismiss(),
    'updates:skip': (): Promise<UpdateView> => updates.skip()
  }
}
