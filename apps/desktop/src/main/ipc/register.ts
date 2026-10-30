import type { IpcMain } from 'electron'
import { invokeChannels } from '@tdc/ipc-contract'
import type { InvokeRoute } from './router'

/** Binds one ipcMain.handle per contract channel to the validating router. */
export function registerInvokeRoute(ipcMain: IpcMain, route: InvokeRoute): () => void {
  const channels = Object.keys(invokeChannels)
  for (const channel of channels) {
    // senderFrame is null once the frame has navigated away or been destroyed.
    ipcMain.handle(channel, (event, input: unknown) =>
      route(channel, input, event.senderFrame?.url)
    )
  }
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
