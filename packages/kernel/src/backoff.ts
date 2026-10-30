/** Exponential backoff with jitter: initial, initial·base, initial·base², … capped at maxMs. */
export interface Backoff {
  /** The delay before the next attempt, in ms. */
  next(): number
  reset(): void
  readonly attempts: number
}

export function createBackoff(options: {
  initialMs?: number
  base?: number
  maxMs: number
  /** ±fraction of random variation, so many clients don't retry in lockstep. */
  jitter?: number
  random?: () => number
}): Backoff {
  const { initialMs = 1000, base = 2, maxMs, jitter = 0.1, random = Math.random } = options
  if (base <= 1) throw new RangeError('base must be greater than 1')
  let attempts = 0
  return {
    next() {
      const ideal = initialMs * base ** attempts
      // Stop growing once capped, so the exponent can't overflow on long outages.
      if (ideal < maxMs) attempts++
      const varied = ideal * (1 - jitter + 2 * jitter * random())
      return Math.min(maxMs, Math.max(0, varied))
    },
    reset() {
      attempts = 0
    },
    get attempts() {
      return attempts
    }
  }
}
