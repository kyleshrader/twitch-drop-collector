import type { CampaignView } from '@tdc/ipc-contract'
import { describe, expect, it } from 'vitest'
import { pastCampaigns, snapshotOf } from './past-campaigns'

const campaign = (id: string): CampaignView => ({
  id,
  name: `Campaign ${id}`,
  game: 'Rust',
  gameId: 'g1',
  state: 'active',
  linked: true,
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2026-11-08T00:00:00.000Z',
  allowListed: false,
  allowedChannels: [],
  badgesEmotes: false,
  drops: [
    {
      id: `${id}-d1`,
      name: 'Hoodie',
      minutes: 30,
      requiredMinutes: 60,
      claimed: false,
      awaitsConnection: false,
      rewards: ['Hoodie'],
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-11-08T00:00:00.000Z'
    }
  ]
})

describe('past campaigns', () => {
  const savedAt = new Date('2026-11-07T12:00:00Z')

  it('shows the saved copies of campaigns Twitch no longer lists, as ended', () => {
    const snapshots = ['a', 'b'].map((id) => ({ ...snapshotOf(campaign(id)), savedAt }))
    const past = pastCampaigns(snapshots, new Set(['a']))
    expect(past).toHaveLength(1)
    expect(past[0]).toMatchObject({
      id: 'b',
      state: 'expired',
      archived: true,
      lastSeenAt: savedAt.toISOString()
    })
    // Everything else as saved: the drops and their progress too.
    expect(past[0]!.drops[0]).toMatchObject({ name: 'Hoodie', minutes: 30, requiredMinutes: 60 })
  })

  it('leaves out copies it can no longer read', () => {
    const past = pastCampaigns(
      [
        { id: 'x', gameId: 'g1', data: 'not json', savedAt },
        { id: 'y', gameId: 'g1', data: '{"id":"y"}', savedAt }
      ],
      new Set()
    )
    expect(past).toEqual([])
  })

  it('saves a campaign without the fields that only describe it as past', () => {
    const saved = JSON.parse(
      snapshotOf({ ...campaign('a'), archived: true, lastSeenAt: savedAt.toISOString() }).data
    ) as Record<string, unknown>
    expect(saved).not.toHaveProperty('archived')
    expect(saved).not.toHaveProperty('lastSeenAt')
  })
})
