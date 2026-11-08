import { describe, expect, it } from 'vitest'
import { autoscrollStep, DEAD_ZONE } from './autoscroll'

describe('middle-click autoscroll speed', () => {
  it('stands still near the marker, then speeds up with distance, both ways', () => {
    expect(autoscrollStep(0)).toBe(0)
    expect(autoscrollStep(DEAD_ZONE)).toBe(0)
    expect(autoscrollStep(-DEAD_ZONE)).toBe(0)
    const near = autoscrollStep(DEAD_ZONE + 20)
    const far = autoscrollStep(DEAD_ZONE + 200)
    expect(near).toBeGreaterThan(0)
    expect(far).toBeGreaterThan(near)
    expect(autoscrollStep(-(DEAD_ZONE + 200))).toBe(-far)
  })

  it('has a top speed', () => {
    expect(autoscrollStep(5000)).toBe(80)
  })
})
