// Twitch service URLs. Injected everywhere so tests can point the clients at a mock server.
export interface TwitchEndpoints {
  gql: string
  usher: string
  pubsub: string
}

export const TWITCH_ENDPOINTS: TwitchEndpoints = {
  gql: 'https://gql.twitch.tv/gql',
  usher: 'https://usher.ttvnw.net',
  pubsub: 'wss://pubsub-edge.twitch.tv/v1'
}
