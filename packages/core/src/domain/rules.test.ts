// Drop and campaign rules, from docs/port-plan.md §3 "Campaigns and drops".
import { describe, expect, it } from 'vitest'
import {
  benefit,
  campaign,
  channel,
  drop,
  hoursFromNow,
  NOW,
  preferences,
  RUST,
  MARVEL,
  SPECIAL_GAME,
  stream
} from './builders.test-support'
import {
  applyDropMinutes,
  bumpEstimatedMinutes,
  campaignAvailability,
  campaignRemainingMinutes,
  canClaimDrop,
  canEarnCampaign,
  canEarnCampaignWithin,
  canEarnDrop,
  firstEarnableDrop,
  isEligible,
  markClaimed,
  MAX_EXTRA_MINUTES,
  totalRemainingMinutes,
  type EarnContext
} from './rules'

const ctx = (overrides: Partial<EarnContext> = {}): EarnContext => ({
  now: NOW,
  preferences: preferences(),
  ...overrides
})

describe('eligibility', () => {
  it('needs a linked account for ordinary rewards', () => {
    expect(isEligible(campaign({ linked: true }), preferences())).toBe(true)
    expect(isEligible(campaign({ linked: false }), preferences())).toBe(false)
  })

  it('makes badge and emote campaigns depend on the setting, linked or not', () => {
    const emotes = campaign({
      linked: false,
      drops: [drop({ benefits: [benefit({ type: 'EMOTE' })] })]
    })
    expect(isEligible(emotes, preferences({ enableBadgesEmotes: false }))).toBe(false)
    expect(isEligible(emotes, preferences({ enableBadgesEmotes: true }))).toBe(true)
    expect(
      isEligible({ ...emotes, linked: true }, preferences({ enableBadgesEmotes: false }))
    ).toBe(false)
  })
})

describe('earning a drop', () => {
  const earnable = (d = drop(), c = campaign({ drops: [d] })): boolean => canEarnDrop(d, c, NOW)

  it('is possible for an unclaimed drop with rewards inside its time window', () => {
    expect(earnable()).toBe(true)
  })

  it.each([
    ['already claimed', drop({ claimed: true })],
    ['no required minutes', drop({ requiredMinutes: 0 })],
    ['not started', drop({ startsAt: hoursFromNow(1) })],
    ['ended', drop({ endsAt: NOW })],
    ['no rewards and no part in a chain', drop({ benefits: [] })],
    ['15 estimated minutes already', drop({ extraMinutes: MAX_EXTRA_MINUTES })]
  ])('is not possible when %s', (_name, d) => {
    expect(earnable(d)).toBe(false)
  })

  it('waits for precondition drops to be claimed', () => {
    const first = drop({ id: 'a' })
    const second = drop({ id: 'b', preconditionIds: ['a'] })
    expect(canEarnDrop(second, campaign({ drops: [first, second] }), NOW)).toBe(false)
    const claimedFirst = { ...first, claimed: true }
    expect(canEarnDrop(second, campaign({ drops: [claimedFirst, second] }), NOW)).toBe(true)
  })

  it('counts a reward-less drop that unlocks another as earnable', () => {
    const stepping = drop({ id: 'a', benefits: [] })
    const reward = drop({ id: 'b', preconditionIds: ['a'] })
    expect(canEarnDrop(stepping, campaign({ drops: [stepping, reward] }), NOW)).toBe(true)
  })
})

describe('earning from a campaign on a channel', () => {
  it('needs an eligible, active campaign with an earnable drop', () => {
    expect(canEarnCampaign(campaign(), ctx())).toBe(true)
    expect(canEarnCampaign(campaign({ linked: false }), ctx())).toBe(false)
    expect(canEarnCampaign(campaign({ status: 'EXPIRED' }), ctx())).toBe(false)
    expect(canEarnCampaign(campaign({ startsAt: hoursFromNow(1) }), ctx())).toBe(false)
    expect(canEarnCampaign(campaign({ drops: [drop({ claimed: true })] }), ctx())).toBe(false)
  })

  it('needs the channel to stream the campaign’s game', () => {
    expect(canEarnCampaign(campaign(), ctx(), channel())).toBe(true)
    const wrongGame = channel({ stream: stream({ game: MARVEL }) })
    expect(canEarnCampaign(campaign(), ctx(), wrongGame)).toBe(false)
  })

  it('honours the allowed-channel list', () => {
    const acl = campaign({ allowedChannels: [{ id: 'channel-9', login: 'partner' }] })
    expect(canEarnCampaign(acl, ctx(), channel({ id: 'channel-1' }))).toBe(false)
    expect(canEarnCampaign(acl, ctx(), channel({ id: 'channel-9' }))).toBe(true)
  })

  it('lets special games be earned on any channel', () => {
    const special = campaign({ game: SPECIAL_GAME })
    expect(canEarnCampaign(special, ctx(), channel({ stream: stream({ game: MARVEL }) }))).toBe(
      true
    )
  })

  it('can ignore the channel’s live state (for the available-drops check)', () => {
    const offlineish = channel({ stream: stream({ game: MARVEL }) })
    expect(canEarnCampaign(campaign(), ctx(), offlineish, { ignoreChannelStatus: true })).toBe(true)
  })
})

describe('earning within the next hour', () => {
  it('includes campaigns that start before the cut-off', () => {
    const soon = campaign({
      status: 'UPCOMING',
      startsAt: hoursFromNow(0.5),
      drops: [drop({ startsAt: hoursFromNow(0.5) })]
    })
    expect(canEarnCampaignWithin(soon, ctx(), hoursFromNow(1))).toBe(true)
    const later = campaign({
      status: 'UPCOMING',
      startsAt: hoursFromNow(2),
      drops: [drop({ startsAt: hoursFromNow(2) })]
    })
    expect(canEarnCampaignWithin(later, ctx(), hoursFromNow(1))).toBe(false)
  })

  it('excludes ended, expired and ineligible campaigns', () => {
    const cutoff = hoursFromNow(1)
    expect(canEarnCampaignWithin(campaign({ endsAt: NOW }), ctx(), cutoff)).toBe(false)
    expect(canEarnCampaignWithin(campaign({ status: 'EXPIRED' }), ctx(), cutoff)).toBe(false)
    expect(canEarnCampaignWithin(campaign({ linked: false }), ctx(), cutoff)).toBe(false)
  })
})

describe('claiming', () => {
  const c = campaign({ endsAt: hoursFromNow(-1) })

  it('is possible with a claim ID until a day after the campaign ends', () => {
    expect(canClaimDrop(drop({ claimId: 'x' }), c, NOW)).toBe(true)
    expect(canClaimDrop(drop({ claimId: 'x' }), c, hoursFromNow(22.99))).toBe(true)
    expect(canClaimDrop(drop({ claimId: 'x' }), c, hoursFromNow(23))).toBe(false)
  })

  it('is not possible without a claim ID or once claimed', () => {
    expect(canClaimDrop(drop(), c, NOW)).toBe(false)
    expect(canClaimDrop(drop({ claimId: 'x', claimed: true }), c, NOW)).toBe(false)
  })

  it('marks the drop claimed and complete', () => {
    const claimed = markClaimed(
      campaign({ drops: [drop({ id: 'a', realMinutes: 50, extraMinutes: 3 })] }),
      'a'
    )
    expect(claimed.drops[0]).toMatchObject({ claimed: true, realMinutes: 60, extraMinutes: 0 })
  })
})

describe('minutes and progress', () => {
  it('applies a progress update to every drop in the campaign, clamped', () => {
    const c = campaign({
      drops: [
        drop({ id: 'a', requiredMinutes: 60, realMinutes: 10, extraMinutes: 2 }),
        drop({ id: 'b', requiredMinutes: 30, realMinutes: 25 })
      ]
    })
    const updated = applyDropMinutes(c, 'a', 20)
    expect(updated.drops.map((d) => [d.realMinutes, d.extraMinutes])).toEqual([
      [20, 0],
      [30, 0]
    ])
  })

  it('ignores updates for unknown drops', () => {
    const c = campaign()
    expect(applyDropMinutes(c, 'nope', 20)).toBe(c)
  })

  it('estimates a minute on drops that can be earned, up to the cap', () => {
    let c = campaign({ drops: [drop({ extraMinutes: MAX_EXTRA_MINUTES - 2 })] })
    let result = bumpEstimatedMinutes(c, ctx(), channel())
    expect(result).toMatchObject({ reachedCap: false })
    c = result.campaign
    result = bumpEstimatedMinutes(c, ctx(), channel())
    expect(result.reachedCap).toBe(true)
    expect(result.campaign.drops[0]?.extraMinutes).toBe(MAX_EXTRA_MINUTES)
  })

  it('adds the longest precondition chain to the remaining minutes', () => {
    const a = drop({ id: 'a', requiredMinutes: 30, realMinutes: 10 })
    const b = drop({ id: 'b', requiredMinutes: 60, preconditionIds: ['a'] })
    const c = campaign({ drops: [a, b] })
    expect(totalRemainingMinutes(b, c)).toBe(80)
    expect(campaignRemainingMinutes(c)).toBe(80)
  })

  it('measures availability as minutes left in the window per minute still needed', () => {
    const c = campaign({ drops: [drop({ endsAt: hoursFromNow(2), requiredMinutes: 60 })] })
    expect(campaignAvailability(c, NOW)).toBe(2)
    const done = campaign({ drops: [drop({ requiredMinutes: 60, realMinutes: 60 })] })
    expect(campaignAvailability(done, NOW)).toBe(Number.POSITIVE_INFINITY)
  })

  it('picks the earnable drop closest to completion first', () => {
    const c = campaign({
      drops: [
        drop({ id: 'far', requiredMinutes: 120 }),
        drop({ id: 'near', requiredMinutes: 60, realMinutes: 30 }),
        drop({ id: 'done', claimed: true })
      ]
    })
    expect(firstEarnableDrop(c, ctx())?.id).toBe('near')
  })
})

describe('games', () => {
  it('treats only the special game IDs as special', () => {
    expect(
      canEarnCampaign(
        campaign({ game: RUST }),
        ctx(),
        channel({ stream: stream({ game: MARVEL }) })
      )
    ).toBe(false)
  })
})
