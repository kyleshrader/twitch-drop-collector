// The History page: what the app has done on this computer, as one timeline built by main from
// the local database (claims, watch sessions, campaigns seen and how they ended).
import { z } from 'zod'

const Id = z.string().min(1).max(200)
const Text = z.string().max(500)
const When = z.string().max(40)

export const HistoryClaimView = z.object({
  kind: z.literal('claim'),
  id: Id,
  at: When,
  game: Text,
  campaignId: Id,
  campaign: Text.optional(),
  drop: Text,
  rewards: z.array(Text).max(50),
  imageUrl: z.string().max(2000).optional(),
  /** The time is Twitch's award time (claimed elsewhere, or before the app recorded claims). */
  fromTwitch: z.boolean().optional()
})

export const HistoryWatchView = z.object({
  kind: z.literal('watch'),
  id: Id,
  /** When the session started. */
  at: When,
  endedAt: When,
  minutes: z.number().nonnegative(),
  game: Text,
  channelLogin: Text,
  channelName: Text,
  campaignId: Id.optional(),
  campaign: Text.optional()
})

export const HistoryEndedView = z.object({
  kind: z.literal('ended'),
  id: Id,
  /** When the campaign ended. */
  at: When,
  game: Text,
  campaignId: Id,
  campaign: Text,
  claimed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** notEarnable: the account couldn't earn it (not linked, or badges and emotes off). */
  outcome: z.enum(['completed', 'partial', 'missed', 'notEarnable']),
  watchedMinutes: z.number().nonnegative()
})

export const HistoryNewView = z.object({
  kind: z.literal('new'),
  id: Id,
  at: When,
  game: Text,
  campaigns: z.array(z.object({ id: Id, name: Text })).max(200)
})

/** A game the Library hadn't had before: its first campaigns turned up. */
export const HistoryNewGameView = z.object({
  kind: z.literal('newGame'),
  id: Id,
  at: When,
  game: Text,
  campaigns: z.array(z.object({ id: Id, name: Text })).max(200)
})

/** A campaign seen while upcoming started. */
export const HistoryStartedView = z.object({
  kind: z.literal('started'),
  id: Id,
  at: When,
  game: Text,
  campaignId: Id,
  campaign: Text
})

/** A game put on the Priority or Excluded list, or taken off (notSet). */
export const HistoryListView = z.object({
  kind: z.literal('list'),
  id: Id,
  at: When,
  game: Text,
  list: z.enum(['priority', 'excluded', 'notSet'])
})

/** The account was linked for a game (its campaigns became earnable). */
export const HistoryLinkedView = z.object({
  kind: z.literal('linked'),
  id: Id,
  at: When,
  game: Text
})

/** The app itself: mining paused or resumed by the user, or the app updated. */
export const HistoryAppView = z.object({
  kind: z.literal('app'),
  id: Id,
  at: When,
  event: z.enum(['paused', 'resumed', 'updated']),
  version: z.string().max(50).optional(),
  from: z.string().max(50).optional()
})

export const HistoryEntryView = z.discriminatedUnion('kind', [
  HistoryClaimView,
  HistoryWatchView,
  HistoryEndedView,
  HistoryNewView,
  HistoryNewGameView,
  HistoryStartedView,
  HistoryListView,
  HistoryLinkedView,
  HistoryAppView
])
export type HistoryEntryView = z.infer<typeof HistoryEntryView>
export type HistoryKind = HistoryEntryView['kind']

export const HistoryView = z.object({
  /** When the history starts: the app's first record on this computer. */
  startedAt: When.optional(),
  /** How many campaigns were already running when the history started. */
  runningAtStart: z.number().int().nonnegative(),
  /** Newest first. */
  entries: z.array(HistoryEntryView).max(20_000)
})
export type HistoryView = z.infer<typeof HistoryView>
