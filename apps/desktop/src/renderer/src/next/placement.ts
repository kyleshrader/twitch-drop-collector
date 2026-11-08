// Where a popover goes so it stays inside the window (used by Popover in parts.tsx).

/** Space kept between a popover and the window's edges. */
const EDGE = 8
/** Gap between the button and its popover (matches .pop in ui.module.css). */
const GAP = 6
/** The tallest a popover gets, however much room there is. */
export const MAX_HEIGHT = 520

export interface Placement {
  up: boolean
  align: 'start' | 'end'
  maxHeight?: number
}

/**
 * Where a popover fits in the window: below its button unless it fits better above, aligned
 * the asked way unless that runs off the side, and no taller than the room it has (it scrolls
 * inside then).
 */
export function placePopover(input: {
  button: { top: number; bottom: number; left: number; right: number }
  panel: { width: number; height: number }
  window: { width: number; height: number }
  prefer: { up: boolean; align: 'start' | 'end' }
}): Placement {
  const { button, panel, window: view, prefer } = input
  const below = view.height - button.bottom - GAP - EDGE
  const above = button.top - GAP - EDGE
  const fitsBelow = panel.height <= below
  const fitsAbove = panel.height <= above
  const up = prefer.up
    ? fitsAbove || (!fitsBelow && above > below)
    : !fitsBelow && (fitsAbove || above > below)
  const room = Math.max(0, up ? above : below)
  const fitsStart = button.left + panel.width <= view.width - EDGE
  const fitsEnd = button.right - panel.width >= EDGE
  const align =
    prefer.align === 'start'
      ? fitsStart || !fitsEnd
        ? 'start'
        : 'end'
      : fitsEnd || !fitsStart
        ? 'end'
        : 'start'
  return { up, align, ...(panel.height > room ? { maxHeight: room } : {}) }
}
