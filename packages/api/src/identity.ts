// Twitch identity endpoints (id.twitch.tv): token validation and the OAuth device-code flow.
import { z } from 'zod'
import { ResponseShapeError } from './errors'
import type { HttpClient } from './http'
import { pickUserAgent, type ClientProfile } from './profiles'

export const TokenInfo = z.looseObject({
  client_id: z.string(),
  login: z.string(),
  user_id: z.string(),
  /** Seconds until expiry; 0 for tokens that don't expire. */
  expires_in: z.number().nullish()
})
export type TokenInfo = z.infer<typeof TokenInfo>

export const DeviceCode = z.looseObject({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  /** Seconds between polls. */
  interval: z.number(),
  /** Seconds until the code expires. */
  expires_in: z.number()
})
export type DeviceCode = z.infer<typeof DeviceCode>

const TokenGrant = z.looseObject({
  access_token: z.string(),
  refresh_token: z.string().nullish()
})

export type DevicePoll =
  | { status: 'granted'; accessToken: string; refreshToken?: string }
  | { status: 'pending' }
  | { status: 'slowDown' }
  | { status: 'expired' }
  | { status: 'denied'; message: string }

export interface IdentityClient {
  /** The token's owner, or undefined if Twitch says the token is invalid (401). */
  validate(accessToken: string, signal?: AbortSignal): Promise<TokenInfo | undefined>
  requestDeviceCode(signal?: AbortSignal): Promise<DeviceCode>
  pollDeviceCode(deviceCode: string, signal?: AbortSignal): Promise<DevicePoll>
}

function parse<T>(schema: z.ZodType<T>, operation: string, text: string): T {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ResponseShapeError(operation, ['response is not JSON'])
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    throw new ResponseShapeError(
      operation,
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    )
  }
  return result.data
}

export function createIdentityClient(deps: {
  http: HttpClient
  profile: ClientProfile
  /** Base URL, normally https://id.twitch.tv. */
  url: string
  deviceId: () => string
}): IdentityClient {
  const { http, profile, url, deviceId } = deps
  const userAgent = pickUserAgent(profile)
  const headers = (): Record<string, string> => ({
    Accept: 'application/json',
    'User-Agent': userAgent,
    'Client-Id': profile.clientId,
    Origin: profile.clientUrl,
    Referer: profile.clientUrl,
    'X-Device-Id': deviceId()
  })

  return {
    async validate(accessToken, signal) {
      const response = await http.request({
        method: 'GET',
        url: `${url}/oauth2/validate`,
        headers: { Authorization: `OAuth ${accessToken}` },
        signal
      })
      if (response.status === 401) return undefined
      if (response.status !== 200) {
        throw new ResponseShapeError('validate', [`HTTP ${response.status}`])
      }
      return parse(TokenInfo, 'validate', response.text)
    },

    async requestDeviceCode(signal) {
      const response = await http.request({
        method: 'POST',
        url: `${url}/oauth2/device`,
        headers: headers(),
        form: { client_id: profile.clientId, scopes: '' },
        signal
      })
      if (response.status !== 200) {
        throw new ResponseShapeError('device code', [`HTTP ${response.status}: ${response.text}`])
      }
      return parse(DeviceCode, 'device code', response.text)
    },

    async pollDeviceCode(deviceCode, signal) {
      const response = await http.request({
        method: 'POST',
        url: `${url}/oauth2/token`,
        headers: headers(),
        form: {
          client_id: profile.clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        },
        signal
      })
      if (response.status === 200) {
        const grant = parse(TokenGrant, 'device token', response.text)
        return {
          status: 'granted',
          accessToken: grant.access_token,
          ...(grant.refresh_token ? { refreshToken: grant.refresh_token } : {})
        }
      }
      // RFC 8628 §3.5 error codes; Twitch sends them in "message".
      let message = ''
      try {
        const body = JSON.parse(response.text) as { message?: unknown; error?: unknown }
        message = String(body.message ?? body.error ?? '')
      } catch {
        // Not JSON: treat as still pending, as upstream does.
      }
      if (message === '' || message === 'authorization_pending') return { status: 'pending' }
      if (message === 'slow_down') return { status: 'slowDown' }
      if (message === 'expired_token' || message === 'invalid device code') {
        return { status: 'expired' }
      }
      return { status: 'denied', message }
    }
  }
}
