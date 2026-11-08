import type { ChannelView } from '@tdc/ipc-contract'
import { describe, expect, it } from 'vitest'
import { channelsFor } from './channels'

const channel = (login: string, overrides: Partial<ChannelView> = {}): ChannelView => ({
  id: login,
  login,
  aclBased: false,
  online: true,
  ...overrides
})

// Watching ExileCon on its allowed channel; Eternal Return, next in Up next, brought its own
// allowed channels in.
const channels = [
  channel('jinatv_', { aclBased: true, game: 'Path of Exile 2', viewers: 900 }),
  channel('er_streamer', { aclBased: true, game: 'Eternal Return', viewers: 5000 }),
  channel('er_other', { aclBased: true, game: 'Path of Exile 2', viewers: 50 }),
  channel('poe_big', { game: 'Path of Exile 2', viewers: 20_000 }),
  channel('offline_one', { game: 'Path of Exile 2', unwatchable: 'offline' })
]
const logins = (list: ChannelView[]): string[] => list.map((c) => c.login)

describe('channelsFor', () => {
  it("offers only a listed campaign's own channels, not another campaign's", () => {
    const exileCon = { game: 'Path of Exile 2', allowedLogins: ['JinaTV_'] }
    expect(logins(channelsFor(exileCon, channels, 'jinatv_'))).toEqual(['jinatv_'])
  })

  it('offers channels streaming the game when any channel counts, watchable first', () => {
    const anyChannel = { game: 'Path of Exile 2', allowedLogins: [] }
    expect(logins(channelsFor(anyChannel, channels, undefined))).toEqual(['poe_big', 'offline_one'])
  })

  it('keeps the channel being watched', () => {
    const anyChannel = { game: 'Path of Exile 2' }
    expect(logins(channelsFor(anyChannel, channels, 'er_streamer'))).toEqual([
      'poe_big',
      'er_streamer',
      'offline_one'
    ])
  })
})
