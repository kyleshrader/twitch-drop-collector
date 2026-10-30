import availableDropsFixture from '@tdc/api/fixtures/twitch/available-drops.json'
import directoryFixture from '@tdc/api/fixtures/twitch/game-directory.json'
import streamInfoFixture from '@tdc/api/fixtures/twitch/stream-info.json'
import { describe, expect, it, vi } from 'vitest'
import { campaign, NOW, preferences, RUST, SPECIAL_GAME } from '../domain/builders.test-support'
import type { EarnContext } from '../domain/rules'
import { fakeGql, testLogger, type FakeGql } from '../test-support/fake-gql'
import { createChannelService, gameSlug } from './channel-service'

const ctx: EarnContext = { now: NOW, preferences: preferences() }
const RUST_WITH_SLUG = { ...RUST, slug: 'rust' }
const clone = <T>(value: T): T => structuredClone(value)

/** A fake Twitch answering with the live fixtures. */
function twitch(): FakeGql {
  const byLogin = new Map(streamInfoFixture.map((item) => [item.data.user.login, item.data]))
  const byChannel = new Map(availableDropsFixture.map((item) => [item.data.channel.id, item.data]))
  return fakeGql({
    DirectoryPage_Game: () => clone(directoryFixture[0]!.data),
    VideoPlayerStreamInfoOverlayChannel: (input) =>
      clone(byLogin.get((input as { login: string }).login) ?? { user: null }),
    DropsHighlightService_AvailableDrops: (input) =>
      clone(
        byChannel.get((input as { channelId: string }).channelId) ?? {
          channel: { id: 'x', viewerDropCampaigns: [] }
        }
      )
  })
}

function setup(options: { availableDropsCheck?: boolean; client?: FakeGql } = {}) {
  const client = options.client ?? twitch()
  const service = createChannelService({
    gql: client,
    availableDropsCheck: () => options.availableDropsCheck ?? false,
    logger: testLogger()
  })
  return { service, client }
}

describe('channel service', () => {
  it('finds live drops-enabled channels in the directory for games without an allow-list', async () => {
    const { service, client } = setup()
    const channels = await service.refresh({
      campaigns: [campaign({ game: RUST_WITH_SLUG })],
      wanted: [RUST_WITH_SLUG],
      ctx
    })
    expect(client.calls['DirectoryPage_Game']).toEqual([
      { slug: 'rust', limit: 20, dropsEnabledOnly: true }
    ])
    // Ranked by viewers; channel IDs are the broadcasters', not the streams'.
    expect(channels.map((c) => [c.login, c.id, c.stream?.viewers])).toEqual([
      ['vincentsmg', '97160118', 653],
      ['enardo247', '1509166070', 41],
      ['vinni_tv_', '742044363', 30]
    ])
    expect(channels.every((c) => !c.aclBased && c.stream?.dropsEnabled)).toBe(true)
  })

  it('checks allow-listed channels live in bulk, keeping offline ones last', async () => {
    const acl = campaign({
      game: RUST_WITH_SLUG,
      allowedChannels: [
        { id: '742044363', login: 'vinni_tv_' },
        { id: '1', login: 'offline_streamer', displayName: 'Offline' },
        { id: '97160118', login: 'vincentsmg' }
      ]
    })
    const { service, client } = setup()
    const channels = await service.refresh({ campaigns: [acl], wanted: [RUST_WITH_SLUG], ctx })

    expect(client.calls['VideoPlayerStreamInfoOverlayChannel']).toHaveLength(3)
    expect(client.calls['DirectoryPage_Game']).toBeUndefined()
    expect(channels.map((c) => [c.login, c.aclBased, c.stream?.viewers ?? 'offline'])).toEqual([
      ['vincentsmg', true, 653],
      ['vinni_tv_', true, 30],
      ['offline_streamer', true, 'offline']
    ])
    expect(channels[0]?.displayName).toBe('VincentSMG')
    expect(channels[0]?.stream?.game).toEqual({ id: '263490', name: 'Rust', slug: 'rust' })
  })

  it('with the available-drops check, trusts only channels running an earnable campaign', async () => {
    const special = campaign({ id: 'df28c49a-special', game: SPECIAL_GAME })
    const acl = campaign({
      game: RUST_WITH_SLUG,
      allowedChannels: [
        { id: '97160118', login: 'vincentsmg' },
        { id: '742044363', login: 'vinni_tv_' }
      ]
    })
    const client = twitch()
    // Only the first channel's available drops include our special campaign's ID.
    client.handle('DropsHighlightService_AvailableDrops', (input) => ({
      channel: {
        id: (input as { channelId: string }).channelId,
        viewerDropCampaigns:
          (input as { channelId: string }).channelId === '97160118' ? [{ id: special.id }] : []
      }
    }))
    const { service } = setup({ availableDropsCheck: true, client })
    const channels = await service.refresh({
      campaigns: [acl, special],
      wanted: [RUST_WITH_SLUG],
      ctx
    })
    expect(Object.fromEntries(channels.map((c) => [c.login, c.stream?.dropsEnabled]))).toEqual({
      vincentsmg: true,
      vinni_tv_: false
    })
  })

  it('ignores games that aren’t wanted', async () => {
    const { service, client } = setup()
    expect(await service.refresh({ campaigns: [campaign()], wanted: [], ctx })).toEqual([])
    expect(client.calls['DirectoryPage_Game']).toBeUndefined()
  })

  it('tracks a channel going offline, coming back and changing viewers', async () => {
    const { service } = setup()
    await service.refresh({
      campaigns: [campaign({ game: RUST_WITH_SLUG })],
      wanted: [RUST_WITH_SLUG],
      ctx
    })
    const changes = vi.fn()
    service.onChange(changes)

    expect(service.setOffline('97160118')?.viewers).toBe(653)
    expect(service.get('97160118')?.stream).toBeUndefined()

    const update = await service.updateStream('97160118', { campaigns: [], ctx })
    expect(update?.before).toBeUndefined()
    expect(update?.after?.viewers).toBe(653)

    service.setViewers('97160118', 700)
    expect(service.get('97160118')?.stream?.viewers).toBe(700)
    expect(changes).toHaveBeenCalledTimes(3)
  })

  it('builds directory slugs from game names when none came with the game', () => {
    expect(gameSlug({ id: '1', name: "Tom Clancy's Rainbow Six Siege" })).toBe(
      'tom-clancys-rainbow-six-siege'
    )
    expect(gameSlug({ id: '1', name: 'Marvel Rivals', slug: 'marvel-rivals' })).toBe(
      'marvel-rivals'
    )
  })
})
