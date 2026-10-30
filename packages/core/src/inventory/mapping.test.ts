import { gql } from '@tdc/api'
import campaignDetailsFixture from '@tdc/api/fixtures/twitch/campaign-details.json'
import campaignsFixture from '@tdc/api/fixtures/twitch/campaigns.json'
import inventoryFixture from '@tdc/api/fixtures/twitch/inventory.json'
import { describe, expect, it } from 'vitest'
import { buildCampaigns, mergeRaw, withoutImageSize } from './mapping'

// The real (anonymised) responses, parsed with the same schemas the client uses.
const inventory = gql.Inventory.data.parse(inventoryFixture[0]!.data).currentUser.inventory
const campaignList =
  gql.Campaigns.data.parse(campaignsFixture[0]!.data).currentUser.dropCampaigns ?? []
const details = campaignDetailsFixture
  .map((item) => gql.CampaignDetailsQuery.data.parse(item.data).user?.dropCampaign)
  .filter((c) => c !== null && c !== undefined)

const fromFixtures = () =>
  buildCampaigns({
    inProgress: inventory.dropCampaignsInProgress ?? [],
    claimedRewards: inventory.gameEventDrops ?? [],
    campaignList,
    details
  })

describe('buildCampaigns on live data', () => {
  it('builds every in-progress and detailed campaign', () => {
    const { campaigns, problems } = fromFixtures()
    expect(problems).toEqual([])
    expect(campaigns.map((c) => c.game.name).sort()).toEqual(
      [
        'Crimson Desert',
        'Dark and Darker',
        'Overwatch',
        'Rainbow Six Siege',
        ...details.map((d) => d.game?.displayName ?? '').filter((n) => n !== 'Dark and Darker')
      ].sort()
    )
  })

  it('keeps progress, claims and claim IDs from the inventory', () => {
    const r6 = fromFixtures().campaigns.find((c) => c.game.name === 'Rainbow Six Siege')!
    expect(r6.status).toBe('EXPIRED')
    expect(r6.drops.map((d) => d.claimed)).toEqual([true, true, false, false])
    expect(r6.drops.map((d) => d.realMinutes)).toEqual([60, 180, 181, 181])
    expect(r6.drops.map((d) => d.claimId !== undefined)).toEqual([true, true, false, false])
    expect(r6.drops[0]?.claimId).toMatch(/^10000001#/)
  })

  it('takes box art and account linking from the campaign list', () => {
    const darker = fromFixtures().campaigns.find((c) => c.game.name === 'Dark and Darker')!
    expect(darker.linked).toBe(false)
    expect(darker.imageUrl).toBe('https://static-cdn.jtvnw.net/ttv-boxart/2009321156_IGDB.jpg')
    expect(darker.drops.length).toBeGreaterThan(0)
    expect(darker.drops.every((d) => d.realMinutes === 0 && !d.claimed)).toBe(true)
  })

  it('keeps allow-lists, as id, login and display name', () => {
    const { campaigns } = fromFixtures()
    const ootp = campaigns.find((c) => c.game.name === 'Out of the Park Baseball 27')!
    expect(ootp.allowedChannels).toHaveLength(3)
    expect(ootp.allowedChannels[0]).toEqual({
      id: '15850551',
      login: 'sporer',
      displayName: 'Sporer'
    })
    // Some allow-lists come without display names; those map to id and login only.
    for (const channel of campaigns.flatMap((c) => c.allowedChannels)) {
      expect(channel.login).toEqual(expect.any(String))
      expect(Object.keys(channel).every((k) => ['id', 'login', 'displayName'].includes(k))).toBe(
        true
      )
    }
  })

  it('reads benefits with their reward type', () => {
    const overwatch = fromFixtures().campaigns.find((c) => c.game.name === 'Overwatch')!
    expect(overwatch.drops.length).toBe(10)
    expect(overwatch.drops.filter((d) => d.claimed)).toHaveLength(1)
    expect(overwatch.drops[0]?.benefits[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      type: expect.stringMatching(/^(BADGE|EMOTE|DIRECT_ENTITLEMENT|UNKNOWN)$/)
    })
  })
})

describe('mergeRaw', () => {
  it('prefers the primary value, recurses into objects, and fills gaps from the secondary', () => {
    expect(
      mergeRaw(
        { id: 'c', self: { isAccountConnected: true }, timeBasedDrops: [{ id: 'd', self: {} }] },
        {
          id: 'c',
          name: 'Campaign',
          self: { isAccountConnected: false, extra: 1 },
          timeBasedDrops: [{ id: 'd' }, { id: 'e' }]
        }
      )
    ).toEqual({
      id: 'c',
      name: 'Campaign',
      self: { isAccountConnected: true, extra: 1 },
      // Lists aren't merged element by element: the primary's list wins, as upstream.
      timeBasedDrops: [{ id: 'd', self: {} }]
    })
  })
})

describe('buildCampaigns edge cases', () => {
  const base = details[0]!

  it('marks a drop claimed when all its rewards were awarded inside the drop’s window', () => {
    const drop = base.timeBasedDrops[0]!
    const benefitId = drop.benefitEdges![0]!.benefit.id
    const inWindow = new Date(new Date(drop.startAt).getTime() + 60_000).toISOString()
    const { campaigns } = buildCampaigns({
      inProgress: [],
      claimedRewards: [{ id: benefitId, lastAwardedAt: inWindow }],
      campaignList,
      details: [base]
    })
    expect(campaigns[0]?.drops.find((d) => d.id === drop.id)?.claimed).toBe(true)

    const before = new Date(new Date(drop.startAt).getTime() - 60_000).toISOString()
    const earlier = buildCampaigns({
      inProgress: [],
      claimedRewards: [{ id: benefitId, lastAwardedAt: before }],
      campaignList,
      details: [base]
    })
    expect(earlier.campaigns[0]?.drops.find((d) => d.id === drop.id)?.claimed).toBe(false)
  })

  it('skips campaigns without a game, and reports campaigns it can’t read', () => {
    const { campaigns, problems } = buildCampaigns({
      inProgress: [
        { ...base, id: 'no-game', game: null },
        { id: 'broken', timeBasedDrops: [] }
      ],
      claimedRewards: [],
      campaignList: [],
      details: []
    })
    expect(campaigns).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/broken/)
  })

  it('strips size suffixes from box art URLs', () => {
    expect(withoutImageSize('https://x/263490_IGDB-285x380.jpg')).toBe('https://x/263490_IGDB.jpg')
    expect(withoutImageSize('https://x/a.png')).toBe('https://x/a.png')
  })
})
