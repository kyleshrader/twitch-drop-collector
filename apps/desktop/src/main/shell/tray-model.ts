// What the tray shows for a miner view: tooltip, status line, menu and badge colour. Pure, so the
// wording and enabling rules are unit-tested; tray.ts turns it into Electron objects.
import type { MinerView } from '@tdc/ipc-contract'

export type TrayAction = 'toggleWindow' | 'reload' | 'quit'
export type TrayMenuItem =
  | { kind: 'status'; label: string }
  | { kind: 'separator' }
  | { kind: 'action'; action: TrayAction; label: string; enabled: boolean }

export interface TrayContent {
  tooltip: string
  menu: TrayMenuItem[]
  /** RGB of the status badge on the icon; undefined shows the plain icon. */
  badge: readonly [number, number, number] | undefined
}

const APP_NAME = 'Twitch Drop Collector'
/** Windows cuts tray tooltips at 127 characters. */
const TOOLTIP_MAX = 127

const BADGES: Record<MinerView['status'], TrayContent['badge']> = {
  stopped: undefined,
  loading: [56, 139, 253],
  idle: [139, 148, 158],
  watching: [46, 160, 67],
  error: [248, 81, 73],
  paused: [210, 153, 34]
}

export function statusLine(view: MinerView): string {
  switch (view.status) {
    case 'stopped':
      return 'Not mining (sign in to start)'
    case 'loading':
      return 'Loading campaigns…'
    case 'watching': {
      const drop = view.active?.drop
      const channel = view.watching ? (view.watching.displayName ?? view.watching.login) : ''
      const progress = drop ? ` · ${drop.minutes}/${drop.requiredMinutes} min` : ''
      return `Mining ${view.active?.game ?? ''}${channel ? ` on ${channel}` : ''}${progress}`.trim()
    }
    case 'idle':
      return view.message ? `Idle: ${view.message}` : 'Idle'
    case 'error':
      return view.message ? `Problem: ${view.message}` : 'Problem'
    case 'paused':
      return view.message ? `Paused: ${view.message}` : 'Paused'
  }
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

export function trayContent(view: MinerView, windowVisible: boolean): TrayContent {
  const status = statusLine(view)
  const canReload = view.status !== 'stopped' && view.status !== 'paused'
  return {
    tooltip: clip(`${APP_NAME}\n${status}`, TOOLTIP_MAX),
    badge: BADGES[view.status],
    menu: [
      { kind: 'status', label: clip(status, 80) },
      { kind: 'separator' },
      {
        kind: 'action',
        action: 'toggleWindow',
        label: windowVisible ? 'Hide window' : 'Show window',
        enabled: true
      },
      { kind: 'action', action: 'reload', label: 'Reload campaigns', enabled: canReload },
      { kind: 'separator' },
      { kind: 'action', action: 'quit', label: 'Quit', enabled: true }
    ]
  }
}

/**
 * Paints a round badge with a light ring in the bottom-right quarter of a square BGRA bitmap
 * (Chromium's native pixel order), in place.
 */
export function paintBadge(
  bitmap: Uint8Array,
  size: number,
  [r, g, b]: readonly [number, number, number]
): void {
  const radius = size * 0.24
  const ring = Math.max(1, size / 16)
  const center = size - radius - 0.5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center)
      if (distance > radius) continue
      const i = (y * size + x) * 4
      const fill = distance > radius - ring ? [255, 255, 255] : [r, g, b]
      bitmap[i] = fill[2]!
      bitmap[i + 1] = fill[1]!
      bitmap[i + 2] = fill[0]!
      bitmap[i + 3] = 255
    }
  }
}
