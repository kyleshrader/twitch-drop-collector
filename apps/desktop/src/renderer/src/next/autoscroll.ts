// Middle-click autoscroll, as in a browser on Windows. Electron leaves Chromium's own one off,
// and turning it on takes a Blink feature switch the security checklist advises against, so the
// new UI does it itself:
// - press and release the middle button: a marker appears and the page scrolls towards the
//   mouse, faster the further away it is, until the next click or Escape;
// - press, drag and release: scrolls while the button is held.
// It scrolls the nearest scrollable area under the mouse (the page, or a Library list).
import { useEffect } from 'react'

/** Pixels around the marker where nothing scrolls. */
export const DEAD_ZONE = 12

/** Pixels to scroll per frame for a mouse `offset` pixels from the marker. */
export function autoscrollStep(offset: number): number {
  const distance = Math.abs(offset) - DEAD_ZONE
  if (distance <= 0) return 0
  return Math.sign(offset) * Math.min(80, Math.pow(distance, 1.3) / 12)
}

function scrollableAt(target: EventTarget | null): HTMLElement | undefined {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue
    const { overflowY } = getComputedStyle(el)
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el
    }
  }
  return undefined
}

/** Middle clicks on links, buttons and fields keep their own meaning. */
const interactive = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('a[href], button, input, textarea, select, [contenteditable="true"]') !== null

export function useMiddleClickScroll(markerClass: string | undefined): void {
  useEffect(() => {
    let stop: (() => void) | undefined

    const start = (down: MouseEvent, area: HTMLElement): void => {
      const origin = { x: down.clientX, y: down.clientY }
      let mouseY = origin.y
      let dragged = false
      const marker = document.createElement('div')
      if (markerClass) marker.className = markerClass
      marker.setAttribute('aria-hidden', 'true')
      marker.style.left = `${origin.x}px`
      marker.style.top = `${origin.y}px`
      document.body.append(marker)
      const previousCursor = document.documentElement.style.cursor
      document.documentElement.style.cursor = 'ns-resize'

      let frame = requestAnimationFrame(function tick() {
        area.scrollTop += autoscrollStep(mouseY - origin.y)
        frame = requestAnimationFrame(tick)
      })
      const onMove = (event: MouseEvent): void => {
        mouseY = event.clientY
        if (Math.abs(event.clientY - origin.y) > DEAD_ZONE) dragged = true
      }
      const onUp = (event: MouseEvent): void => {
        // Released after dragging: stop. Released in place: keep going until the next click.
        if (event.button === 1 && dragged) finish()
      }
      const onDown = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        finish()
      }
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') finish()
      }
      const finish = (): void => {
        cancelAnimationFrame(frame)
        marker.remove()
        document.documentElement.style.cursor = previousCursor
        window.removeEventListener('mousemove', onMove, true)
        window.removeEventListener('mouseup', onUp, true)
        window.removeEventListener('mousedown', onDown, true)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('wheel', finish, true)
        window.removeEventListener('blur', finish)
        stop = undefined
      }
      // Registered after this mousedown, so it isn't the click that stops it.
      window.addEventListener('mousemove', onMove, true)
      window.addEventListener('mouseup', onUp, true)
      window.addEventListener('mousedown', onDown, true)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('wheel', finish, true)
      window.addEventListener('blur', finish)
      stop = finish
    }

    const onMiddleDown = (event: MouseEvent): void => {
      if (event.button !== 1 || stop || interactive(event.target)) return
      const area = scrollableAt(event.target)
      if (!area) return
      // No paste-on-middle-click or other default; this click is ours.
      event.preventDefault()
      start(event, area)
    }
    // A middle click also fires auxclick, which would open links in a new window.
    const onAuxClick = (event: MouseEvent): void => {
      if (event.button === 1 && !interactive(event.target)) event.preventDefault()
    }

    window.addEventListener('mousedown', onMiddleDown)
    window.addEventListener('auxclick', onAuxClick)
    return () => {
      stop?.()
      window.removeEventListener('mousedown', onMiddleDown)
      window.removeEventListener('auxclick', onAuxClick)
    }
  }, [markerClass])
}
