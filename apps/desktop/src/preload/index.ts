import { contextBridge, ipcRenderer } from 'electron'
import { isInvokeChannel, type PreloadApi } from '@tdc/ipc-contract'

// Only contract channels reach ipcRenderer; ipcRenderer itself is never exposed.
// Main validates the sender and the input, so this is a channel allowlist, not the security check.
const api: PreloadApi = {
  invoke: (channel, input) =>
    isInvokeChannel(channel)
      ? ipcRenderer.invoke(channel, input)
      : Promise.resolve({
          ok: false,
          error: { code: 'UNKNOWN_CHANNEL', message: 'Unknown channel' }
        })
}

contextBridge.exposeInMainWorld('api', api)
