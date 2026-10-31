// Main → renderer push events, defined once with their payload schemas. Main validates each
// payload before sending; the preload only forwards events in this list.
import type { z } from 'zod'
import { AuthStateView } from './auth'
import { MinerView } from './miner'
import { UpdateView } from './updates'

export const eventChannels = {
  'auth:state': AuthStateView,
  'miner:state': MinerView,
  'updates:state': UpdateView
} as const satisfies Record<string, z.ZodType>

export type EventChannel = keyof typeof eventChannels
export type EventPayload<E extends EventChannel> = z.output<(typeof eventChannels)[E]>

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && Object.hasOwn(eventChannels, value)
}
