// The new UI's keyboard: app shortcuts, and arrow keys in lists.
//
// Shortcuts are declared where their control is drawn, with aria-keyshortcuts (which screen
// readers announce too); this file finds the control and presses or focuses it:
//   Ctrl+F     the page's search (the Library's, from a page without one)
//   F1         the account menu
//   Alt+1/2/3  Library / Drops / History
// Back and forward (Alt+←/→, mouse buttons 4/5) are in router.ts; refreshing (Ctrl+R, F5) is
// handled in main, which keeps the window itself from reloading.
//
// Lists are marked with data-keys:
//   "list"   one Tab stop; ↑/↓ (and ←/→) move between its links and buttons; Home/End
//   "row"    the same, for a row of buttons (←/→)
//   "grid"   one Tab stop; ←/→ move along, ↑/↓ to the row above or below
//   "cards"  ↑/↓ move to the same control in the card above or below (cards are its
//            [data-key-card] children); Tab still goes through each card's controls
//   "menu"   ↑/↓ move between its items; no Tab stop of its own (a popover)
// In a "list", "row" or "grid" the Tab stop is the item last focused, else the current or
// pressed one, else the first.
import { useEffect } from 'react'
import { navigate, type Route } from './router'

type Kind = 'list' | 'row' | 'grid' | 'cards' | 'menu'
const ROVING: ReadonlySet<Kind> = new Set(['list', 'row', 'grid'])

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]'

const visible = (el: HTMLElement): boolean =>
  el.getClientRects().length > 0 && !el.closest('[hidden], [inert]')

/** The container an element's arrow keys belong to: the nearest one. */
const containerOf = (el: Element): HTMLElement | null => el.closest<HTMLElement>('[data-keys]')

const kindOf = (container: HTMLElement): Kind => container.dataset['keys'] as Kind

/** A container's own items: its focusable elements that aren't inside a nested container. */
export function itemsOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      containerOf(el) === container &&
      visible(el) &&
      el.dataset['keyCard'] === undefined &&
      !el.matches('input, select, textarea')
  )
}

/** Which item holds the Tab stop. */
function activeItem(items: readonly HTMLElement[]): HTMLElement | undefined {
  return (
    items.find((el) => el.dataset['keyActive'] !== undefined) ??
    items.find((el) => el.getAttribute('aria-current') === 'page') ??
    items.find((el) => el.getAttribute('aria-pressed') === 'true') ??
    items[0]
  )
}

/** Gives each roving container exactly one Tab stop. */
export function updateTabStops(root: ParentNode = document): void {
  for (const container of root.querySelectorAll<HTMLElement>('[data-keys]')) {
    if (!ROVING.has(kindOf(container))) continue
    const items = itemsOf(container)
    const active = activeItem(items)
    for (const el of items) {
      const tabIndex = el === active ? '0' : '-1'
      if (el.getAttribute('tabindex') !== tabIndex) el.setAttribute('tabindex', tabIndex)
    }
  }
}

/** The item nearest `from` in the row above (-1) or below (1), in a wrapped grid. */
function gridNeighbour(
  items: readonly HTMLElement[],
  from: HTMLElement,
  direction: -1 | 1
): HTMLElement | undefined {
  const box = from.getBoundingClientRect()
  const centre = box.left + box.width / 2
  const rows = items
    .map((el) => ({ el, box: el.getBoundingClientRect() }))
    .filter(({ box: b }) => (direction > 0 ? b.top > box.bottom - 2 : b.bottom < box.top + 2))
  if (rows.length === 0) return undefined
  const rowTop =
    direction > 0
      ? Math.min(...rows.map((r) => r.box.top))
      : Math.max(...rows.map((r) => r.box.top))
  const row = rows.filter((r) => Math.abs(r.box.top - rowTop) < 2)
  return row.reduce((best, r) =>
    Math.abs(r.box.left + r.box.width / 2 - centre) <
    Math.abs(best.box.left + best.box.width / 2 - centre)
      ? r
      : best
  ).el
}

/**
 * Where an arrow key moves focus from `el`, or undefined to leave the key alone. A key the
 * nearest list doesn't use (↑ in a row of buttons inside a card) goes to the list around it.
 */
export function arrowTarget(el: HTMLElement, key: string): HTMLElement | undefined {
  for (let c = containerOf(el); c; c = c.parentElement ? containerOf(c.parentElement) : null) {
    const target = targetIn(c, el, key)
    if (target) return target
    // A menu keeps its keys: ↑ past the first item doesn't leave the popover.
    if (kindOf(c) === 'menu') return undefined
  }
  return undefined
}

/** The card (a [data-key-card]) of `container` that holds `el`. */
const cardIn = (container: HTMLElement, el: HTMLElement): HTMLElement | undefined => {
  for (let card = el.closest<HTMLElement>('[data-key-card]'); card;) {
    if (card.parentElement && containerOf(card.parentElement) === container) return card
    card = card.parentElement?.closest<HTMLElement>('[data-key-card]') ?? null
  }
  return undefined
}

function targetIn(container: HTMLElement, el: HTMLElement, key: string): HTMLElement | undefined {
  const kind = kindOf(container)

  if (kind === 'cards') {
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return undefined
    // Cards nested in a card (a campaign row in a game's card) are cards of the same list.
    const card = el.closest<HTMLElement>('[data-key-card]')
    if (!card || !cardIn(container, card)) return undefined
    const cards = [...container.querySelectorAll<HTMLElement>('[data-key-card]')].filter(
      (c) => cardIn(container, c) !== undefined && visible(c)
    )
    const next = cards[cards.indexOf(card) + (key === 'ArrowUp' ? -1 : 1)]
    if (!next) return undefined
    // A card's own controls, not those of cards nested in it.
    const controls = (c: HTMLElement): HTMLElement[] =>
      [...c.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (x) => visible(x) && x.closest('[data-key-card]') === c && !x.matches('[data-key-card]')
      )
    const index = controls(card).indexOf(el)
    const targets = controls(next)
    return targets[Math.max(0, Math.min(index, targets.length - 1))] ?? next
  }

  const items = itemsOf(container)
  const index = items.indexOf(el)
  if (index < 0) return undefined
  if (key === 'Home') return items[0]
  if (key === 'End') return items.at(-1)
  const back = key === 'ArrowUp' || key === 'ArrowLeft'
  const forward = key === 'ArrowDown' || key === 'ArrowRight'
  if (kind === 'row' && (key === 'ArrowUp' || key === 'ArrowDown')) return undefined
  if (kind === 'grid' && (key === 'ArrowUp' || key === 'ArrowDown')) {
    return gridNeighbour(items, el, key === 'ArrowUp' ? -1 : 1)
  }
  if (back) return items[index - 1]
  if (forward) return items[index + 1]
  return undefined
}

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

/** Fields keep their own arrow keys (moving the caret, changing a select). */
const isField = (el: Element): boolean =>
  el.matches('input, select, textarea, [contenteditable="true"]')

/** The key combination of an event, in aria-keyshortcuts' spelling ("Control+F", "Alt+1"). */
export function shortcutOf(event: KeyboardEvent): string {
  const key = event.code.startsWith('Digit')
    ? event.code.slice('Digit'.length)
    : event.key.length === 1
      ? event.key.toUpperCase()
      : event.key
  return [
    event.ctrlKey ? 'Control' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : '',
    key
  ]
    .filter(Boolean)
    .join('+')
}

/** Pages a shortcut opens when nothing on screen declares it. */
const FALLBACK: Readonly<Record<string, Route>> = {
  'Control+F': { page: 'library' }
}

function withShortcut(shortcut: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[aria-keyshortcuts]')].find(
    (el) =>
      visible(el) && (el.getAttribute('aria-keyshortcuts') ?? '').split(' ').includes(shortcut)
  )
}

function press(el: HTMLElement): void {
  el.focus()
  if (isField(el)) {
    if (el instanceof HTMLInputElement) el.select()
  } else {
    el.click()
  }
}

export function useKeyboard(): void {
  useEffect(() => {
    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => updateTabStops())
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled', 'aria-current', 'aria-pressed']
    })
    schedule()

    // The item focused last keeps the Tab stop when Tab leaves the list and comes back.
    const onFocusIn = (event: FocusEvent): void => {
      const el = event.target
      if (!(el instanceof HTMLElement)) return
      const container = containerOf(el)
      if (!container || !ROVING.has(kindOf(container)) || !itemsOf(container).includes(el)) return
      for (const other of container.querySelectorAll<HTMLElement>('[data-key-active]')) {
        delete other.dataset['keyActive']
      }
      el.dataset['keyActive'] = ''
      schedule()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const shortcut = shortcutOf(event)
      const target = withShortcut(shortcut)
      if (target) {
        event.preventDefault()
        press(target)
        return
      }
      const fallback = FALLBACK[shortcut]
      if (fallback) {
        event.preventDefault()
        navigate(fallback)
        // The page draws on the next frames; press its control once it's there.
        let tries = 0
        const retry = (): void => {
          const el = withShortcut(shortcut)
          if (el) press(el)
          else if (++tries < 20) requestAnimationFrame(retry)
        }
        requestAnimationFrame(retry)
        return
      }
      if (!ARROW_KEYS.has(event.key) || event.ctrlKey || event.altKey || event.metaKey) return
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || isField(el)) return
      const next = arrowTarget(el, event.key)
      if (next) {
        event.preventDefault()
        next.focus()
      }
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
