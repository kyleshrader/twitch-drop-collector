import type { App, Shell } from 'electron'
import type { SettingsService } from '@tdc/config'
import type { AppInfo, SettingsView } from '@tdc/ipc-contract'
import { isSafeExternalUrl } from '../policy'
import type { InvokeHandlers } from './router'

export function createInvokeHandlers(deps: {
  app: Pick<App, 'getName' | 'getVersion'>
  shell: Pick<Shell, 'openExternal'>
  platform: string
  settings: Pick<SettingsService, 'get' | 'update'>
}): InvokeHandlers {
  const { app, shell, platform, settings } = deps
  return {
    'app:getInfo': (): AppInfo => ({ name: app.getName(), version: app.getVersion(), platform }),
    'shell:openExternal': async ({ url }): Promise<{ opened: boolean }> => {
      // The schema already requires https; this keeps main's own rule authoritative.
      if (!isSafeExternalUrl(url)) return { opened: false }
      await shell.openExternal(url)
      return { opened: true }
    },
    // The transport and config schemas are the same shape (checked by settings-contract.test.ts).
    'settings:get': (): SettingsView => settings.get(),
    'settings:update': (patch): Promise<SettingsView> => settings.update(patch)
  }
}
