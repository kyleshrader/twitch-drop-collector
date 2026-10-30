import { contextBridge } from 'electron'

// The typed API from @tdc/ipc-contract is exposed here at M3. ipcRenderer is never exposed directly.
const api = {}

contextBridge.exposeInMainWorld('api', api)
