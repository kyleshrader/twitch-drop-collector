// Twitch client identities: which first-party client our requests present as. The client ID
// question (Twitch ToS) is decided in M7; see docs/port-plan.md §4.
export interface ClientProfile {
  name: string
  clientId: string
  /** Sent as Origin and Referer on GQL requests. */
  clientUrl: string
  userAgents: readonly string[]
}

export const CLIENT_PROFILES = {
  androidApp: {
    name: 'Android app',
    clientId: 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp',
    clientUrl: 'https://www.twitch.tv',
    userAgents: [
      'Dalvik/2.1.0 (Linux; U; Android 16; SM-S911B Build/TP1A.220624.014) tv.twitch.android.app/31.8.0/3108006',
      'Dalvik/2.1.0 (Linux; U; Android 16; SM-S938B Build/BP2A.250605.031) tv.twitch.android.app/31.8.0/3108006',
      'Dalvik/2.1.0 (Linux; U; Android 15; SM-G990B Build/AP3A.240905.015.A2) tv.twitch.android.app/31.8.0/3108006'
    ]
  },
  web: {
    name: 'Web',
    clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    clientUrl: 'https://www.twitch.tv',
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
    ]
  }
} as const satisfies Record<string, ClientProfile>

/** One user agent per app run, picked at startup. */
export function pickUserAgent(profile: ClientProfile, random: () => number = Math.random): string {
  return (
    profile.userAgents[Math.floor(random() * profile.userAgents.length)] ?? profile.userAgents[0]!
  )
}
