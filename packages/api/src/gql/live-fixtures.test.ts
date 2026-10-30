// Our response schemas against real (anonymised) Twitch responses. If Twitch changes a field we
// rely on, re-capture the fixtures (see fixtures/twitch/README.md) and this test shows what broke.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GqlOperation } from './operation'
import {
  AvailableDrops,
  CampaignDetailsQuery,
  Campaigns,
  CurrentDrop,
  GameDirectory,
  Inventory,
  StreamInfo
} from './operations'

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'twitch')

/** Parses every item of a captured batch with the operation's schema. */
function parseFixture<V, D>(operation: GqlOperation<V, D>, file: string): D[] {
  const items = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as {
    data: unknown
    errors?: unknown
  }[]
  return items.map((item) => {
    expect(item.errors).toBeUndefined()
    const parsed = operation.data.safeParse(item.data)
    if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
    return parsed.data
  })
}

describe('live Twitch responses', () => {
  it('inventory: in-progress campaigns with drop progress, and claimed rewards', () => {
    const [data] = parseFixture(Inventory, 'inventory.json')
    const inventory = data!.currentUser.inventory
    expect(inventory.dropCampaignsInProgress?.length).toBeGreaterThan(0)
    expect(inventory.dropCampaignsInProgress?.[0]?.timeBasedDrops?.[0]?.self).toBeTruthy()
    expect(inventory.gameEventDrops?.length).toBeGreaterThan(0)
  })

  it('campaign list: present for an Android app session', () => {
    const [data] = parseFixture(Campaigns, 'campaigns.json')
    expect(data!.currentUser.dropCampaigns?.some((c) => c.status === 'ACTIVE')).toBe(true)
  })

  it('campaign details: full campaigns, with allow-lists and account-link state', () => {
    const campaigns = parseFixture(CampaignDetailsQuery, 'campaign-details.json').map(
      (r) => r.user?.dropCampaign
    )
    expect(campaigns.every((c) => c !== null && c !== undefined)).toBe(true)
    expect(campaigns.some((c) => (c?.allow?.channels?.length ?? 0) > 0)).toBe(true)
    expect(campaigns.every((c) => typeof c?.self.isAccountConnected === 'boolean')).toBe(true)
  })

  it('channels: directory, stream info, available drops and the current drop', () => {
    const [directory] = parseFixture(GameDirectory, 'game-directory.json')
    expect(directory!.game?.streams?.edges.length).toBeGreaterThan(0)
    expect(parseFixture(StreamInfo, 'stream-info.json').every((s) => s.user?.stream)).toBe(true)
    expect(parseFixture(AvailableDrops, 'available-drops.json').every((a) => a.channel)).toBe(true)
    expect(parseFixture(CurrentDrop, 'current-drop.json')).toHaveLength(1)
  })
})
