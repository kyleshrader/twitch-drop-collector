/** Source of the current time. Domain rules take a Clock (or a Date) instead of calling Date.now. */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }
