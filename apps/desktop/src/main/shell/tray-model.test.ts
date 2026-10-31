import type { MinerView } from '@tdc/ipc-contract'
import { describe, expect, it } from 'vitest'
import { paintBadge, statusLine, trayContent, type TrayAction } from './tray-model'

const base: MinerView = { status: 'idle', wanted: [], channels: [], campaigns: [] }
const watching: MinerView = {
  ...base,
  status: 'watching',
  watching: { id: 'c', login: 'streamer', displayName: 'Streamer', aclBased: false, online: true },
  active: {
    campaignId: 'k',
    campaign: 'Rust Drops',
    game: 'Rust',
    drop: {
      id: 'd',
      name: 'Hoodie',
      minutes: 35,
      requiredMinutes: 60,
      claimed: false,
      awaitsConnection: false,
      rewards: ['Hoodie'],
      startsAt: '2026-10-30T00:00:00Z',
      endsAt: '2026-11-30T00:00:00Z'
    }
  }
}

describe('tray content', () => {
  it('describes what is being mined', () => {
    expect(statusLine(watching)).toBe('Mining Rust on Streamer · 35/60 min')
    expect(statusLine({ ...base, message: 'No campaigns to mine right now' })).toBe(
      'Idle: No campaigns to mine right now'
    )
    expect(statusLine({ ...base, status: 'paused', message: 'Offline' })).toBe('Paused: Offline')
  })

  const action = (view: MinerView, visible: boolean, name: TrayAction) =>
    trayContent(view, visible).menu.find((i) => i.kind === 'action' && i.action === name)

  it('offers show or hide depending on the window', () => {
    expect(action(base, true, 'toggleWindow')).toMatchObject({ label: 'Hide window' })
    expect(action(base, false, 'toggleWindow')).toMatchObject({ label: 'Show window' })
  })

  it('allows a reload only while the miner runs', () => {
    expect(action(watching, true, 'reload')).toMatchObject({ enabled: true })
    expect(action({ ...base, status: 'stopped' }, true, 'reload')).toMatchObject({ enabled: false })
    expect(action({ ...base, status: 'paused' }, true, 'reload')).toMatchObject({ enabled: false })
  })

  it('badges the icon by status, plain when stopped', () => {
    expect(trayContent({ ...base, status: 'stopped' }, true).badge).toBeUndefined()
    const colours = new Set(
      (['loading', 'idle', 'watching', 'error', 'paused'] as const).map((status) =>
        trayContent({ ...base, status }, true).badge?.join()
      )
    )
    expect(colours.size).toBe(5)
  })

  it('keeps the tooltip within Windows’ limit', () => {
    const long = { ...base, status: 'error' as const, message: 'x'.repeat(300) }
    expect(trayContent(long, true).tooltip.length).toBeLessThanOrEqual(127)
  })
})

describe('paintBadge', () => {
  it('paints the bottom-right corner in BGRA and leaves the top-left alone', () => {
    const size = 32
    const bitmap = new Uint8Array(size * size * 4)
    paintBadge(bitmap, size, [10, 20, 30])
    const pixel = (x: number, y: number): number[] => [
      ...bitmap.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)
    ]
    const center = Math.round(size - size * 0.24 - 0.5)
    expect(pixel(center, center)).toEqual([30, 20, 10, 255])
    expect(pixel(0, 0)).toEqual([0, 0, 0, 0])
  })
})
