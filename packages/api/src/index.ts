// Twitch transport: HTTP, GQL, PubSub and stream watching. No domain decisions, and no electron
// or react imports; fetch and WebSocket are injected by the app.
export { TWITCH_ENDPOINTS, type TwitchEndpoints } from './endpoints'
export { GqlError, RequestFailedError, ResponseShapeError } from './errors'
export { createGqlClient, GQL_BATCH_SIZE, type GqlAuth, type GqlClient } from './gql/client'
export { defineOperation, type GqlOperation } from './gql/operation'
export * as gql from './gql/operations'
export {
  createHttpClient,
  type FetchLike,
  type HttpClient,
  type HttpRequest,
  type HttpResponse
} from './http'
export {
  createIdentityClient,
  DeviceCode,
  TokenInfo,
  type DevicePoll,
  type IdentityClient
} from './identity'
export { CLIENT_PROFILES, pickUserAgent, type ClientProfile } from './profiles'
export {
  createPubSub,
  pubsubTopics,
  TooManyTopicsError,
  type RealtimeConnectionStatus,
  type RealtimeSource,
  type WebSocketLike
} from './pubsub'
export { systemScheduler } from './runtime'
export { createHlsWatcher, playlistEntries, type StreamWatcher } from './watch'
