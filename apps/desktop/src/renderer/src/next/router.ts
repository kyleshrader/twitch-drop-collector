// A small hash router: back and forward work (mouse back button, Alt+←), a reload keeps the page,
// and notifications, popovers and tests can open a page by its address.
import { useEffect, useSyncExternalStore } from 'react'

export type Route =
  /** `target`: a campaign or drop id to scroll to (from a notification). */
  | { page: 'drops'; target?: string }
  | { page: 'library'; gameId?: string; group?: string }
  | { page: 'history' }
  | { page: 'settings' }
  | { page: 'updates' }
  /** Signs that Twitch changed its API; `issueId` opens one issue's expected vs actual. */
  | { page: 'twitchApi'; issueId?: string }

export function parseRoute(hash: string): Route {
  const [page, id, group] = hash.replace(/^#\/?/, '').split('/')
  if (page === 'library') {
    // #/library/group/<key> shows one heading's games; #/library/<id> shows one game.
    if (id === 'group' && group) return { page, group: decodeURIComponent(group) }
    return id ? { page, gameId: decodeURIComponent(id) } : { page }
  }
  if (page === 'settings' || page === 'updates' || page === 'history') return { page }
  if (page === 'twitch-api') {
    return id ? { page: 'twitchApi', issueId: decodeURIComponent(id) } : { page: 'twitchApi' }
  }
  if (page === 'drops' && id) return { page, target: decodeURIComponent(id) }
  return { page: 'drops' }
}

export function routeHref(route: Route): string {
  if (route.page === 'twitchApi') {
    return route.issueId ? `#/twitch-api/${encodeURIComponent(route.issueId)}` : '#/twitch-api'
  }
  if (route.page === 'library' && route.gameId) {
    return `#/library/${encodeURIComponent(route.gameId)}`
  }
  if (route.page === 'drops' && route.target) {
    return `#/drops/${encodeURIComponent(route.target)}`
  }
  if (route.page === 'library' && route.group) {
    return `#/library/group/${encodeURIComponent(route.group)}`
  }
  return `#/${route.page}`
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parseRoute(hash)
}

export function navigate(route: Route): void {
  window.location.hash = routeHref(route)
}

/** Back on Alt+← and the mouse's back button, forward on Alt+→ and its forward button. */
export function useHistoryKeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey) return
      if (event.key === 'ArrowLeft') window.history.back()
      else if (event.key === 'ArrowRight') window.history.forward()
    }
    const onMouse = (event: MouseEvent): void => {
      if (event.button === 3) window.history.back()
      else if (event.button === 4) window.history.forward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])
}
