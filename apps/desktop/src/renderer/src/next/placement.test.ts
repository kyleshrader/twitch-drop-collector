import { describe, expect, it } from 'vitest'
import { placePopover } from './placement'

// A 904 × 361 window: the new UI at the minimum window size.
const view = { width: 904, height: 361 }
const panel = { width: 260, height: 220 }
const button = (
  top: number,
  left = 600
): { top: number; bottom: number; left: number; right: number } => ({
  top,
  bottom: top + 28,
  left,
  right: left + 200
})

describe('popover placement', () => {
  it('opens below when it fits', () => {
    expect(
      placePopover({ button: button(40), panel, window: view, prefer: { up: false, align: 'end' } })
    ).toEqual({
      up: false,
      align: 'end'
    })
  })

  it('opens above when it only fits there', () => {
    expect(
      placePopover({
        button: button(300),
        panel,
        window: view,
        prefer: { up: false, align: 'end' }
      })
    ).toEqual({
      up: true,
      align: 'end'
    })
  })

  it('takes the roomier side and scrolls inside when it fits on neither', () => {
    // 150 px above, 155 px below.
    expect(
      placePopover({
        button: button(164),
        panel,
        window: view,
        prefer: { up: false, align: 'end' }
      })
    ).toEqual({ up: false, align: 'end', maxHeight: 155 })
  })

  it('flips its alignment rather than run off the side', () => {
    expect(
      placePopover({
        button: button(40, 760),
        panel,
        window: view,
        prefer: { up: false, align: 'start' }
      })
    ).toMatchObject({ align: 'end' })
    expect(
      placePopover({
        button: button(40, 10),
        panel,
        window: view,
        prefer: { up: false, align: 'end' }
      })
    ).toMatchObject({ align: 'start' })
  })
})
