// Twitch service URLs. Injected everywhere so tests can point the clients at a mock server.
export interface TwitchEndpoints {
  /** Twitch website: the login page and the token redirect. */
  web: string
  /** id.twitch.tv: token validation and the device-code flow. */
  id: string
  gql: string
  usher: string
  pubsub: string
}

export const TWITCH_ENDPOINTS: TwitchEndpoints = {
  web: 'https://www.twitch.tv',
  id: 'https://id.twitch.tv',
  gql: 'https://gql.twitch.tv/gql',
  usher: 'https://usher.ttvnw.net',
  pubsub: 'wss://pubsub-edge.twitch.tv/v1'
}
