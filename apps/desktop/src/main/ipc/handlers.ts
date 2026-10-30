import type { App, Shell } from 'electron'
import type { AppInfo } from '@tdc/ipc-contract'
import { isSafeExternalUrl } from '../policy'
import type { InvokeHandlers } from './router'

export function createInvokeHandlers(deps: {
  app: Pick<App, 'getName' | 'getVersion'>
  shell: Pick<Shell, 'openExternal'>
  platform: string
}): InvokeHandlers {
  const { app, shell, platform } = deps
  return {
    'app:getInfo': (): AppInfo => ({ name: app.getName(), version: app.getVersion(), platform }),
    'shell:openExternal': async ({ url }): Promise<{ opened: boolean }> => {
      // The schema already requires https; this keeps main's own rule authoritative.
      if (!isSafeExternalUrl(url)) return { opened: false }
      await shell.openExternal(url)
      return { opened: true }
    }
  }
}
