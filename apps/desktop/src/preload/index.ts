import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { isEventChannel, isInvokeChannel, type PreloadApi } from '@tdc/ipc-contract'

// Only contract channels reach ipcRenderer; ipcRenderer itself is never exposed.
// Main validates the sender and the input, so this is a channel allowlist, not the security check.
const api: PreloadApi = {
  invoke: (channel, input) =>
    isInvokeChannel(channel)
      ? ipcRenderer.invoke(channel, input)
      : Promise.resolve({
          ok: false,
          error: { code: 'UNKNOWN_CHANNEL', message: 'Unknown channel' }
        }),
  on: (event, listener) => {
    if (!isEventChannel(event)) return () => {}
    // Pass the payload only: the IpcRendererEvent (with its sender) stays in the preload.
    const forward = (_event: IpcRendererEvent, payload: unknown): void =>
      listener(payload as Parameters<typeof listener>[0])
    ipcRenderer.on(event, forward)
    return () => {
      ipcRenderer.removeListener(event, forward)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
