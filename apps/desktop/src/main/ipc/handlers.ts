import type { App, Shell } from 'electron'
import type { SettingsService } from '@tdc/config'
import type { AuthService } from '@tdc/core'
import type { AppInfo, AuthStateView, MinerView, SettingsView, UpdateView } from '@tdc/ipc-contract'
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
  }
  updates: Pick<Updater, 'view' | 'check' | 'download' | 'install' | 'dismiss' | 'skip'>
}): InvokeHandlers {
  const { app, shell, platform, settings, auth, miner, updates } = deps
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
