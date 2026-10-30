// IPC contract shared by main, preload and renderer. Depends only on zod (dependency rule 7).
export {
  AppInfo,
  OpenExternalInput,
  invokeChannels,
  isInvokeChannel,
  type InvokeArgs,
  type InvokeChannel,
  type InvokeInput,
  type InvokeOutput
} from './channels'
export {
  IpcError,
  type IpcErrorCode,
  type IpcFailure,
  type IpcResult,
  type PreloadApi
} from './result'
