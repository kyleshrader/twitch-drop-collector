import type { GqlClient } from '@tdc/api'
import type { Campaign } from '@tdc/core'
import { createGames, openSqlite, runMigrations } from '@tdc/storage'
import { describe, expect, it, vi } from 'vitest'
import { createGameInfoService, GAME_INFO_MAX_AGE_MS, needsLookup } from './game-info'

const NOW = new Date('2026-11-07T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => logger } as never

function setup(found: Record<string, { id: string; slug?: string; boxArtURL?: string }>): {
  service: ReturnType<typeof createGameInfoService>
  asked: string[][]
} {
  const db = openSqlite(':memory:')
  runMigrations(db)
  const asked: string[][] = []
  const gql = {
    request: vi.fn(),
    batch: vi.fn(async (_op: unknown, inputs: readonly { name: string }[]) => {
      asked.push(inputs.map((i) => i.name))
      return inputs.map((i) => ({ game: found[i.name] ?? null }))
    })
  } as unknown as GqlClient
  const service = createGameInfoService({
    gql,
    games: createGames({ db }),
    clock: { now: () => NOW },
    logger
  })
  return { service, asked }
}

describe('game info', () => {
  it('looks up games it lacks, saves them, and leaves known ones alone', async () => {
    const { service, asked } = setup({
      ROBLOX: {
        id: '23020',
        slug: 'roblox',
        boxArtURL: 'https://static-cdn.jtvnw.net/ttv-boxart/23020_IGDB-285x380.jpg'
      }
    })
    await service.refresh(['ROBLOX', 'Nonexistent'])
    expect(asked).toEqual([['ROBLOX', 'Nonexistent']])
    expect(service.known()).toEqual({
      ROBLOX: {
        id: '23020',
        slug: 'roblox',
        boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/23020_IGDB.jpg'
      },
      Nonexistent: {}
    })
    // Both were just checked: nothing is asked again.
    await service.refresh(['ROBLOX', 'Nonexistent'])
    expect(asked).toHaveLength(1)
  })

  it("saves campaigns' games, and looks one up when its address is missing", async () => {
    const { service, asked } = setup({ Rust: { id: 'g1', slug: 'rust' } })
    const changed = vi.fn()
    service.onChange(changed)
    const campaign = { game: { id: 'g1', name: 'Rust', boxArtUrl: 'rust.jpg' } } as Campaign
    service.fromCampaigns([campaign])
    service.fromCampaigns([campaign])
    expect(changed).toHaveBeenCalledTimes(1)
    await service.refresh(['Rust'])
    expect(asked).toEqual([['Rust']])
    expect(service.known()['Rust']).toEqual({ id: 'g1', slug: 'rust', boxArtUrl: 'rust.jpg' })
  })
})

describe('needsLookup', () => {
  const at = (age: number): Date => new Date(NOW.getTime() - age)
  it('is due when unknown, incomplete or stale', () => {
    expect(needsLookup(undefined, NOW)).toBe(true)
    const full = { name: 'R', id: '1', slug: 'r', boxArtUrl: 'r.jpg' }
    expect(needsLookup({ ...full, checkedAt: at(DAY) }, NOW)).toBe(false)
    expect(needsLookup({ ...full, checkedAt: at(GAME_INFO_MAX_AGE_MS + DAY) }, NOW)).toBe(true)
    expect(needsLookup({ name: 'R', id: '1', checkedAt: at(DAY) }, NOW)).toBe(true)
    // Not found on Twitch: tried again only once it's stale.
    expect(needsLookup({ name: 'R', checkedAt: at(DAY) }, NOW)).toBe(false)
  })
})
