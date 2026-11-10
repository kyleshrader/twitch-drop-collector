import type { SeenRecord } from '@tdc/storage'
import { describe, expect, it } from 'vitest'
import { buildHistory } from './history'

const at = (iso: string): Date => new Date(iso)
const NOW = at('2026-11-10T12:00:00Z')

const seen = (
  id: string,
  firstSeen: string,
  standing?: Partial<NonNullable<SeenRecord['standing']>>
): SeenRecord => ({
  id,
  name: `Campaign ${id}`,
  gameId: 'g1',
  gameName: 'Rust',
  firstSeenAt: at(firstSeen),
  ...(standing
    ? {
        standing: {
          startsAt: at('2026-11-01T00:00:00Z'),
          endsAt: at('2026-11-08T00:00:00Z'),
          lastSeenAt: at('2026-11-07T00:00:00Z'),
          dropsTotal: 3,
          dropsClaimed: 0,
          earnable: true,
          ...standing
        }
      }
    : {})
})

describe('the history timeline', () => {
  it('tells completed, partly done, missed and unearnable campaigns apart once they end', () => {
    const history = buildHistory({
      claims: [
        {
          dropId: 'd1',
          campaignId: 'partial',
          gameName: 'Rust',
          dropName: 'Hoodie',
          rewards: ['Hoodie'],
          claimedAt: at('2026-11-07T10:00:00Z')
        }
      ],
      seen: [
        seen('done', '2026-11-01T00:00:00Z', { dropsClaimed: 3 }),
        // Claimed nothing by the last look, but a claim was recorded for it.
        seen('partial', '2026-11-01T00:00:00Z', {}),
        seen('missed', '2026-11-01T00:00:00Z', {}),
        seen('locked', '2026-11-01T00:00:00Z', { earnable: false }),
        seen('running', '2026-11-01T00:00:00Z', { endsAt: at('2026-11-20T00:00:00Z') }),
        seen('unknown', '2026-11-01T00:00:00Z')
      ],
      sessions: [
        {
          id: 1,
          channelLogin: 'x',
          channelName: 'X',
          gameName: 'Rust',
          campaignId: 'missed',
          campaignName: 'Campaign missed',
          startedAt: at('2026-11-06T10:00:00Z'),
          endedAt: at('2026-11-06T11:30:00Z')
        }
      ],
      now: NOW
    })
    const ended = history.entries.flatMap((e) =>
      e.kind === 'ended' ? [[e.campaignId, e.outcome, e.claimed, e.watchedMinutes]] : []
    )
    expect(ended).toEqual([
      ['done', 'completed', 3, 0],
      ['locked', 'notEarnable', 0, 0],
      ['missed', 'missed', 0, 90],
      ['partial', 'partial', 1, 0]
    ])
    const claim = history.entries.find((e) => e.kind === 'claim')
    expect(claim).toMatchObject({ campaign: 'Campaign partial', drop: 'Hoodie' })
    expect(history.entries.find((e) => e.kind === 'watch')).toMatchObject({ minutes: 90 })
  })

  it('counts the campaigns already running at the start, and groups later finds by game', () => {
    const history = buildHistory({
      claims: [],
      seen: [
        seen('a', '2026-11-01T00:00:00Z'),
        seen('b', '2026-11-01T00:00:00Z'),
        seen('c', '2026-11-05T08:00:00Z'),
        seen('d', '2026-11-05T08:00:00Z'),
        { ...seen('e', '2026-11-05T08:00:00Z'), gameName: 'Rocket League', gameId: 'g2' }
      ],
      sessions: [],
      now: NOW
    })
    expect(history.startedAt).toBe('2026-11-01T00:00:00.000Z')
    expect(history.runningAtStart).toBe(2)
    expect(
      history.entries.map((e) =>
        e.kind === 'new' || e.kind === 'newGame'
          ? [e.kind, e.game, e.campaigns.map((c) => c.id)]
          : e
      )
    ).toEqual([
      // The same time: in ID order. Rocket League's first campaign makes it a new game.
      ['new', 'Rust', ['c', 'd']],
      ['newGame', 'Rocket League', ['e']]
    ])
  })

  it('is empty before anything is recorded', () => {
    expect(buildHistory({ claims: [], seen: [], sessions: [], now: NOW })).toEqual({
      runningAtStart: 0,
      entries: []
    })
  })

  it('marks new games, started campaigns, list changes, links, pauses and updates', () => {
    const event = (id: number, kind: string, iso: string, data: Record<string, unknown> = {}) => ({
      id,
      kind,
      at: at(iso),
      data
    })
    const history = buildHistory({
      claims: [],
      seen: [
        seen('first', '2026-11-01T00:00:00Z'),
        // A game seen for the first time after the first load: new in the Library.
        { ...seen('fresh', '2026-11-03T00:00:00Z'), gameId: 'g9', gameName: 'Palia' },
        // Seen while upcoming; it has started since.
        seen('soon', '2026-11-02T00:00:00Z', {
          startsAt: at('2026-11-04T00:00:00Z'),
          endsAt: at('2026-11-30T00:00:00Z')
        })
      ],
      sessions: [],
      events: [
        event(1, 'version', '2026-11-01T00:00:00Z', { version: '1.0.0' }),
        event(2, 'list', '2026-11-05T00:00:00Z', { game: 'Rust', list: 'priority' }),
        event(3, 'linked', '2026-11-06T00:00:00Z', { game: 'Palia' }),
        event(4, 'paused', '2026-11-07T00:00:00Z'),
        event(5, 'resumed', '2026-11-07T01:00:00Z'),
        event(6, 'version', '2026-11-08T00:00:00Z', { version: '1.1.0' }),
        event(7, 'list', '2026-11-08T01:00:00Z', { game: 'Rust', list: 'bogus' })
      ],
      now: NOW
    })
    expect(
      history.entries.map((e) =>
        e.kind === 'app'
          ? [e.kind, e.event, e.version ?? '', e.from ?? '']
          : [e.kind, 'game' in e ? e.game : '']
      )
    ).toEqual([
      ['app', 'updated', '1.1.0', '1.0.0'],
      ['app', 'resumed', '', ''],
      ['app', 'paused', '', ''],
      ['linked', 'Palia'],
      ['list', 'Rust'],
      ['started', 'Rust'],
      ['newGame', 'Palia'],
      ['new', 'Rust']
    ])
  })
})
