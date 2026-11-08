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
export { GameSearchResult, SearchGamesInput } from './games'
export { eventChannels, isEventChannel, type EventChannel, type EventPayload } from './events'
export { IMAGE_ORIGIN, IMAGE_SCHEME, imageSrc } from './images'
export {
  CampaignView,
  ChannelView,
  DropView,
  KnownGameView,
  MinerView,
  QueueEntryView,
  QueuePieceView,
  QueueView,
  SelectChannelInput
} from './miner'
export { RECOMMENDED_QUEUE_RULES, SettingsPatchInput, SettingsView } from './settings'
export { UpdateStatus, UpdateView } from './updates'
export {
  IpcError,
  type IpcErrorCode,
  type IpcFailure,
  type IpcResult,
  type PreloadApi
} from './result'
