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
export { AuthStateView, SignInMethod } from './auth'
export { eventChannels, isEventChannel, type EventChannel, type EventPayload } from './events'
export { IMAGE_ORIGIN, IMAGE_SCHEME, imageSrc } from './images'
export { CampaignView, ChannelView, DropView, MinerView, SelectChannelInput } from './miner'
export { SettingsPatchInput, SettingsView } from './settings'
export { UpdateStatus, UpdateView } from './updates'
export {
  IpcError,
  type IpcErrorCode,
  type IpcFailure,
  type IpcResult,
  type PreloadApi
} from './result'
