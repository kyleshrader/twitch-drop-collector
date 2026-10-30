import { TWITCH_ENDPOINTS, type TwitchEndpoints } from '@tdc/api'
import { z } from 'zod'

const Override = z.strictObject({
  web: z.url().optional(),
  id: z.url().optional(),
  gql: z.url().optional(),
  usher: z.url().optional(),
  pubsub: z.url().optional()
})

/**
 * Twitch endpoints, optionally overridden by TDC_TWITCH_ENDPOINTS (JSON) so end-to-end tests can
 * use a mock Twitch. The override is ignored in packaged builds.
 */
export function resolveEndpoints(
  env: Readonly<Record<string, string | undefined>>,
  isPackaged: boolean
): TwitchEndpoints {
  const raw = env['TDC_TWITCH_ENDPOINTS']
  if (!raw || isPackaged) return TWITCH_ENDPOINTS
  const override = Override.parse(JSON.parse(raw))
  return { ...TWITCH_ENDPOINTS, ...override }
}
