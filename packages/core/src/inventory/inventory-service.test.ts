import campaignDetailsFixture from '@tdc/api/fixtures/twitch/campaign-details.json'
import campaignsFixture from '@tdc/api/fixtures/twitch/campaigns.json'
import inventoryFixture from '@tdc/api/fixtures/twitch/inventory.json'
import { describe, expect, it, vi } from 'vitest'
import { fakeGql, testLogger, type FakeGql } from '../test-support/fake-gql'
import { createInventoryService } from './inventory-service'

const NOW = new Date('2026-10-30T12:00:00Z')
const clone = <T>(value: T): T => structuredClone(value)

/** A fake Twitch answering with the live fixtures; details by campaign ID. */
function twitch(): FakeGql {
  const details = new Map(
    campaignDetailsFixture.map((item) => [item.data.user.dropCampaign.id, item.data])
  )
  return fakeGql({
    Inventory: () => clone(inventoryFixture[0]!.data),
    ViewerDropsDashboard: () => clone(campaignsFixture[0]!.data),
    DropCampaignDetails: (input) =>
      details.get((input as { campaignId: string }).campaignId) ?? {
        user: { id: '10000001', dropCampaign: null }
      }
  })
}

function setup(client = twitch(), now = NOW) {
  const claims = { record: vi.fn(() => true) }
  const service = createInventoryService({
    gql: client,
    userId: () => '10000001',
    claims,
    clock: { now: () => now },
    logger: testLogger()
  })
  return { service, claims, client }
}

/** Inventory where Crimson Desert's first drop is finished and claimable. */
function claimableInventory(): unknown {
  const data = clone(inventoryFixture[0]!.data)
  const crimson = data.currentUser.inventory.dropCampaignsInProgress.find(
    (c) => c.game.name === 'Crimson Desert'
  )!
  const drop = crimson.timeBasedDrops[0]!
  drop.self.isClaimed = false
  drop.self.currentMinutesWatched = drop.requiredMinutesWatched
  drop.self.dropInstanceID = `10000001#${crimson.id}#${drop.id}`
  return data
}

describe('inventory service', () => {
  it('fetches inventory, the campaign list and details, and builds campaigns', async () => {
    const { service, client } = setup()
    const changes = vi.fn()
    service.onChange(changes)

    const campaigns = await service.refresh()

    expect(campaigns.map((c) => c.game.name)).toEqual(
      expect.arrayContaining([
        'Crimson Desert',
        'Rainbow Six Siege',
        'Overwatch',
        'Dark and Darker'
      ])
    )
    // Details are requested only for active and upcoming list entries, keyed by user ID.
    expect(client.calls['DropCampaignDetails']).toEqual(
      campaignsFixture[0]!.data.currentUser.dropCampaigns
        .filter((c) => c.status === 'ACTIVE' || c.status === 'UPCOMING')
        .map((c) => ({ campaignId: c.id, userId: '10000001' }))
    )
    expect(changes).toHaveBeenCalledWith(campaigns)
  })

  it('still builds in-progress campaigns when the campaign list is missing', async () => {
    const client = twitch()
    client.handle('ViewerDropsDashboard', () => ({
      currentUser: { id: '10000001', login: 'test_user', dropCampaigns: null }
    }))
    const { service } = setup(client)
    const campaigns = await service.refresh()
    expect(campaigns.map((c) => c.game.name).sort()).toEqual(
      ['Crimson Desert', 'Overwatch', 'Rainbow Six Siege'].sort()
    )
  })

  it('applies progress to the drop’s campaign', async () => {
    const { service } = setup()
    await service.refresh()
    const overwatch = service.campaigns().find((c) => c.game.name === 'Overwatch')!
    const target = overwatch.drops.find((d) => !d.claimed)!
    const updated = service.updateDropMinutes(target.id, target.realMinutes + 5)
    expect(updated?.drops.find((d) => d.id === target.id)?.realMinutes).toBe(target.realMinutes + 5)
    expect(service.updateDropMinutes('unknown', 5)).toBeUndefined()
  })

  it('claims a finished drop, marks it claimed and records it', async () => {
    const client = twitch()
    client.handle('Inventory', () => claimableInventory())
    client.handle('DropsPage_ClaimDropRewards', () => ({
      claimDropRewards: { status: 'ELIGIBLE_FOR_ALL' }
    }))
    const { service, claims } = setup(client)
    await service.refresh()
    const crimson = service.campaigns().find((c) => c.game.name === 'Crimson Desert')!
    const drop = crimson.drops[0]!

    expect(await service.claim(drop.id)).toBe(true)
    expect(client.calls['DropsPage_ClaimDropRewards']).toEqual([
      { dropInstanceId: `10000001#${crimson.id}#${drop.id}` }
    ])
    expect(service.find(drop.id)?.drop.claimed).toBe(true)
    expect(claims.record).toHaveBeenCalledWith(
      expect.objectContaining({ dropId: drop.id, gameName: 'Crimson Desert', claimedAt: NOW })
    )
  })

  it('reports a claim Twitch didn’t confirm, and leaves the drop unclaimed', async () => {
    const client = twitch()
    client.handle('Inventory', () => claimableInventory())
    client.handle('DropsPage_ClaimDropRewards', () => ({ claimDropRewards: null }))
    const { service, claims } = setup(client)
    await service.refresh()
    const drop = service.campaigns().find((c) => c.game.name === 'Crimson Desert')!.drops[0]!
    expect(await service.claim(drop.id)).toBe(false)
    expect(service.find(drop.id)?.drop.claimed).toBe(false)
    expect(claims.record).not.toHaveBeenCalled()
  })

  it('claims every finished drop that has a claim ID', async () => {
    // The live inventory really has three finished, unclaimed Crimson Desert drops.
    const client = twitch()
    client.handle('DropsPage_ClaimDropRewards', () => ({
      claimDropRewards: { status: 'DROP_INSTANCE_ALREADY_CLAIMED' }
    }))
    const { service } = setup(client)
    await service.refresh()
    const claimed = await service.claimAll()
    expect(claimed.map((d) => d.name)).toEqual(['60 min.', '120 min.', '180 min.'])
    expect(client.calls['DropsPage_ClaimDropRewards']).toHaveLength(3)
    const crimson = service.campaigns().find((c) => c.game.name === 'Crimson Desert')!
    expect(crimson.drops.every((d) => d.claimed)).toBe(true)
  })

  it('records a claim ID that arrives later', async () => {
    const { service } = setup()
    await service.refresh()
    const drop = service
      .campaigns()
      .find((c) => c.game.name === 'Overwatch')!
      .drops.find((d) => !d.claimed)!
    service.setClaimId(drop.id, 'later-claim-id')
    expect(service.find(drop.id)?.drop.claimId).toBe('later-claim-id')
  })
})
