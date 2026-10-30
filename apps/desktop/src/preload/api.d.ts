import type { PreloadApi } from '@tdc/ipc-contract'

declare global {
  interface Window {
    api: PreloadApi
  }
}

export {}
