// History (docs/new-ui/history.md): what the app did on this computer, newest first, by day:
// claims, watching, new campaigns and how campaigns ended. Totals for the range sit on top and
// filter the list; the games beside it filter by game. Main builds the timeline; sums and groups
// are in history.ts.
import { useQuery } from '@tanstack/react-query'
import { imageSrc, type HistoryEntryView, type MinerView } from '@tdc/ipc-contract'
import { useState, type ReactNode } from 'react'
import { invoke } from '../../ipc'
import { duration, fullDate } from '../format'
import { icons, type Icon as IconType } from '../icons'
import { ChannelLink, Cover, Truncated } from '../parts'
import { routeHref } from '../router'
import { strings } from '../strings'
import ui from '../ui.module.css'
import {
  byDay,
  daysAgo,
  gameOf,
  HISTORY_FILTERS,
  HISTORY_RANGES,
  inScope,
  totalsOf,
  visibleEntries,
  type HistoryFilter,
  type HistoryRange
} from './history'
import styles from './History.module.css'

const t = strings.history
const Icon = icons
const {
  page,
  head,
  lead,
  stats,
  stat,
  statValue,
  statLabel,
  statNote,
  toolbar,
  searchBox,
  layout,
  timeline,
  day,
  dayHead,
  dayName,
  dayDate,
  daySummary,
  entry,
  badge,
  badgeClaim,
  badgeWatch,
  badgeGood,
  badgePartial,
  badgeBad,
  badgeNeutral,
  badgeNew,
  rewardImage,
  entryText,
  entryTitle,
  entrySub,
  entryTime,
  gameLink,
  aside,
  asideHead,
  gameRow,
  gameRowOn,
  gameName,
  gameBar,
  gameNumbers,
  startMarker,
  more,
  emptyBox
} = styles
const { segmented, btn, btnSmall, ghost, chip, coverXs, muted, selectable } = ui

/** How many entries show before "Show more". */
const PAGE = 120
/** How many games the side list shows before "Show all". */
const GAMES_SHOWN = 8
const RANGE_KEY = 'tdc.next.history.range'

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' })
const DATE_YEAR = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric'
})
const time = (iso: string): string => TIME.format(new Date(iso))

function storedRange(): HistoryRange {
  try {
    const saved = window.localStorage.getItem(RANGE_KEY)
    return HISTORY_RANGES.find((r) => r === saved) ?? '30d'
  } catch {
    return '30d'
  }
}

/** "Today", "Yesterday", "Monday", or "3 November", with the date beside the first three. */
function dayLabel(start: number, now: number): { name: string; date?: string } {
  const ago = daysAgo(start, now)
  const sameYear = new Date(start).getFullYear() === new Date(now).getFullYear()
  const date = (sameYear ? DATE : DATE_YEAR).format(new Date(start))
  if (ago === 0) return { name: t.today, date }
  if (ago === 1) return { name: t.yesterday, date }
  if (ago < 7) return { name: WEEKDAY.format(new Date(start)), date }
  return { name: `${WEEKDAY.format(new Date(start))} ${date}` }
}

interface GameLookup {
  (game: string): { id?: string | undefined; boxArtUrl?: string | undefined }
}

function GameName(props: { game: string; lookup: GameLookup }): ReactNode {
  const { id } = props.lookup(props.game)
  return id ? (
    <a
      className={gameLink}
      href={routeHref({ page: 'library', gameId: id })}
      data-tip={t.openGame(props.game)}
    >
      {props.game}
    </a>
  ) : (
    <span>{props.game}</span>
  )
}

/** The mark at the start of a row: what kind of thing happened (a claim shows its reward). */
function Badge(props: { e: HistoryEntryView }): ReactNode {
  const { e } = props
  const mark = (cls: string | undefined, Mark: IconType): ReactNode => (
    <span className={`${badge} ${cls ?? ''}`} aria-hidden>
      <Mark />
    </span>
  )
  if (e.kind === 'claim') {
    return e.imageUrl ? (
      <span className={`${badge} ${badgeClaim}`} aria-hidden>
        <img className={rewardImage} src={imageSrc(e.imageUrl)} alt="" loading="lazy" />
      </span>
    ) : (
      mark(badgeClaim, Icon.reward)
    )
  }
  if (e.kind === 'watch') return mark(badgeWatch, Icon.watched)
  if (e.kind === 'new') return mark(badgeNew, Icon.newCampaign)
  if (e.kind === 'newGame') return mark(badgeWatch, Icon.newGame)
  if (e.kind === 'started') return mark(badgeNew, Icon.play)
  if (e.kind === 'linked') return mark(badgeGood, Icon.link)
  if (e.kind === 'list') {
    if (e.list === 'priority') return mark(badgeWatch, Icon.up)
    if (e.list === 'excluded') return mark(badgeNeutral, Icon.excluded)
    return mark(badgeNeutral, Icon.undo)
  }
  if (e.kind === 'app') {
    if (e.event === 'paused') return mark(badgePartial, Icon.pause)
    if (e.event === 'resumed') return mark(badgeWatch, Icon.play)
    return mark(badgeWatch, Icon.update)
  }
  if (e.outcome === 'completed') return mark(badgeGood, Icon.completed)
  if (e.outcome === 'partial') return mark(badgePartial, Icon.partial)
  if (e.outcome === 'missed') return mark(badgeBad, Icon.missed)
  return mark(badgeNeutral, Icon.missed)
}

function Entry(props: { e: HistoryEntryView; lookup: GameLookup }): ReactNode {
  const { e, lookup } = props
  const name = gameOf(e)
  const game = name === undefined ? null : <GameName game={name} lookup={lookup} />
  let title: ReactNode
  let sub: ReactNode
  let when = time(e.at)
  if (e.kind === 'claim') {
    title = <Truncated text={e.rewards.join(', ') || e.drop} selectable />
    sub = (
      <>
        {game}
        {e.campaign && <span className={selectable}> · {e.campaign}</span>}
        {e.fromTwitch && (
          <>
            {' · '}
            <span data-tip={t.fromTwitchTip}>{t.fromTwitch}</span>
          </>
        )}
      </>
    )
  } else if (e.kind === 'watch') {
    when = `${time(e.at)} – ${time(e.endedAt)}`
    title = (
      <span>
        {t.watched(e.minutes)} {t.on} <ChannelLink login={e.channelLogin} name={e.channelName} />
      </span>
    )
    sub = (
      <>
        {game}
        {e.campaign && <span className={selectable}> · {e.campaign}</span>}
      </>
    )
  } else if (e.kind === 'ended') {
    title = <Truncated text={t.ended[e.outcome](e.campaign)} selectable />
    sub = (
      <>
        {game} · {t.endedDrops(e.claimed, e.total)}
        {e.outcome === 'notEarnable' && <> · {t.notEarnable}</>}
        {e.watchedMinutes >= 1 && <> · {t.watchedFor(e.watchedMinutes)}</>}
      </>
    )
  } else if (e.kind === 'started') {
    title = <Truncated text={t.started(e.campaign)} selectable />
    sub = game
  } else if (e.kind === 'list') {
    title = (
      <span>
        {game} {t.list[e.list]}
      </span>
    )
    sub = null
  } else if (e.kind === 'linked') {
    title = (
      <span>
        {t.linked} {game}
      </span>
    )
    sub = null
  } else if (e.kind === 'app') {
    title = e.event === 'updated' ? t.app.updated(e.version ?? '', e.from) : t.app[e.event]
    sub = t.appSub[e.event]
  } else {
    title = (
      <span>
        {e.kind === 'newGame' ? t.newGame : t.newCampaigns(e.campaigns.length)} · {game}
      </span>
    )
    sub = (
      <Truncated text={e.campaigns.map((c) => c.name).join(', ')} className={entrySub} selectable />
    )
  }
  return (
    <li className={entry} data-testid="history-entry" data-kind={e.kind}>
      <Badge e={e} />
      <div className={entryText}>
        <div className={entryTitle}>{title}</div>
        {e.kind === 'new' || e.kind === 'newGame'
          ? sub
          : sub && <div className={entrySub}>{sub}</div>}
      </div>
      <time className={entryTime} dateTime={e.at} data-tip={fullDate(e.at)}>
        {when}
      </time>
    </li>
  )
}

function Stat(props: {
  label: string
  value: string
  note: string
  pressed: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className={stat}
      aria-pressed={props.pressed}
      data-tip={t.statTip(props.label)}
      onClick={props.onClick}
    >
      <span className={statLabel}>{props.label}</span>
      <span className={statValue}>{props.value}</span>
      <span className={statNote}>{props.note}</span>
    </button>
  )
}

export function HistoryPage(props: { miner: MinerView | undefined; now: number }): ReactNode {
  const { miner, now } = props
  const history = useQuery({
    queryKey: ['history'],
    queryFn: () => invoke('history:get'),
    refetchInterval: 30_000
  })
  const [range, setRangeState] = useState<HistoryRange>(storedRange)
  const [filter, setFilterState] = useState<HistoryFilter>('all')
  const [text, setTextState] = useState('')
  const [game, setGameState] = useState<string>()
  const [limit, setLimit] = useState(PAGE)
  const [allGames, setAllGames] = useState(false)
  // Any change to what's shown starts the list from the top again.
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value)
      setLimit(PAGE)
    }
  const setRange = reset((value: HistoryRange) => {
    setRangeState(value)
    try {
      window.localStorage.setItem(RANGE_KEY, value)
    } catch {
      // Remembered until the window closes.
    }
  })
  const setFilter = reset(setFilterState)
  const setText = reset(setTextState)
  const setGame = reset(setGameState)

  const lookup: GameLookup = (name) => {
    const known = miner?.games?.[name]
    const campaign = miner?.campaigns.find((c) => c.game === name)
    return { id: known?.id ?? campaign?.gameId, boxArtUrl: known?.boxArtUrl ?? campaign?.boxArtUrl }
  }

  const data = history.data
  const entries = data?.entries ?? []
  const query = { range, filter, text, game, now }
  const scope = inScope(entries, query)
  const totals = totalsOf(scope)
  const shown = visibleEntries(entries, query)
  const days = byDay(shown.slice(0, limit))
  const sessions = scope.filter((e) => e.kind === 'watch').length
  const filtered = filter !== 'all' || text !== '' || game !== undefined
  const toggleFilter = (value: HistoryFilter): void => setFilter(filter === value ? 'all' : value)
  const maxMinutes = Math.max(1, ...totals.games.map((g) => g.minutes))
  const maxDrops = Math.max(1, ...totals.games.map((g) => g.drops))
  const games = allGames ? totals.games : totals.games.slice(0, GAMES_SHOWN)
  // The very first entry is on screen: say that's where the history starts.
  const startsShown = range === 'all' && !filtered && shown.length <= limit

  return (
    <div className={page}>
      <div className={head}>
        <h2>{t.heading}</h2>
        <div className={segmented} role="group" aria-label={t.rangeLabel} data-keys="row">
          {HISTORY_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {t.ranges[value]}
            </button>
          ))}
        </div>
      </div>
      {data?.startedAt && (
        <p className={lead}>{t.lead(DATE_YEAR.format(new Date(data.startedAt)))}</p>
      )}

      {history.isLoading && <div className={emptyBox}>{t.loading}</div>}
      {history.isError && (
        <div className={emptyBox} role="alert">
          {t.failed}
        </div>
      )}
      {data && entries.length === 0 && (
        <div className={emptyBox}>
          <Icon.history />
          <span>{t.empty}</span>
        </div>
      )}

      {data && entries.length > 0 && (
        <>
          <div className={stats} role="group" aria-label={t.heading}>
            <Stat
              label={t.stats.drops}
              value={String(totals.drops)}
              note={t.dropsNote(totals.games.filter((g) => g.drops > 0).length)}
              pressed={filter === 'claims'}
              onClick={() => toggleFilter('claims')}
            />
            <Stat
              label={t.stats.watched}
              value={totals.minutes >= 1 ? duration(totals.minutes) : '0 m'}
              note={t.watchedNote(sessions)}
              pressed={filter === 'watching'}
              onClick={() => toggleFilter('watching')}
            />
            <Stat
              label={t.stats.completed}
              value={String(totals.completed)}
              note={t.completedNote(totals.ended)}
              pressed={filter === 'campaigns'}
              onClick={() => toggleFilter('campaigns')}
            />
            <Stat
              label={t.stats.missed}
              value={String(totals.missed)}
              note={t.missedNote(totals.partial)}
              pressed={filter === 'campaigns'}
              onClick={() => toggleFilter('campaigns')}
            />
          </div>

          <div className={toolbar}>
            <div className={segmented} role="group" aria-label={t.filterLabel} data-keys="row">
              {HISTORY_FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {t.filters[value]}
                </button>
              ))}
            </div>
            {game && (
              <button
                type="button"
                className={`${chip} ${gameLink}`}
                onClick={() => setGame(undefined)}
                aria-label={t.allGames}
              >
                {t.onlyGame(game)}
                <Icon.close />
              </button>
            )}
            <label className={searchBox}>
              <Icon.search />
              <input
                type="search"
                placeholder={t.search}
                aria-label={t.search}
                aria-keyshortcuts="Control+F"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          </div>

          <div className={layout}>
            <div className={timeline}>
              {shown.length === 0 && (
                <div className={emptyBox}>
                  <span>{t.noMatch}</span>
                  <button
                    type="button"
                    className={`${btn} ${btnSmall}`}
                    onClick={() => {
                      setFilter('all')
                      setText('')
                      setGame(undefined)
                    }}
                  >
                    {t.clearFilters}
                  </button>
                </div>
              )}
              {days.map((d) => {
                const label = dayLabel(d.start, now)
                const summary = t.daySummary(d.drops, d.minutes)
                return (
                  <section key={d.start} className={day} aria-label={label.name}>
                    <h3 className={dayHead}>
                      <span className={dayName}>{label.name}</span>
                      {label.date && <span className={dayDate}>{label.date}</span>}
                      {summary && <span className={daySummary}>{summary}</span>}
                    </h3>
                    <ol>
                      {d.entries.map((e) => (
                        <Entry key={e.id} e={e} lookup={lookup} />
                      ))}
                    </ol>
                  </section>
                )
              })}
              {shown.length > limit && (
                <div className={more}>
                  <button
                    type="button"
                    className={`${btn} ${btnSmall}`}
                    onClick={() => setLimit(limit + PAGE)}
                  >
                    {t.showMore(Math.min(PAGE, shown.length - limit))}
                  </button>
                </div>
              )}
              {startsShown && (
                <div className={startMarker}>
                  <Icon.history />
                  {t.starts(data.runningAtStart)}
                </div>
              )}
            </div>

            {totals.games.length > 0 && (
              <aside className={aside} aria-label={t.games}>
                <div className={asideHead}>
                  <h3>{t.games}</h3>
                  <span className={muted}>{t.gamesNote}</span>
                </div>
                <div data-keys="list">
                  {games.map((g) => {
                    const on = game === g.game
                    const share = totals.minutes >= 1 ? g.minutes / maxMinutes : g.drops / maxDrops
                    return (
                      <button
                        key={g.game}
                        type="button"
                        className={`${gameRow} ${on ? gameRowOn : ''}`}
                        aria-pressed={on}
                        data-tip={on ? t.allGames : t.onlyGame(g.game)}
                        onClick={() => setGame(on ? undefined : g.game)}
                      >
                        <Cover game={g.game} url={lookup(g.game).boxArtUrl} size={coverXs} />
                        <span className={gameName}>
                          <Truncated text={g.game} />
                          <span className={gameBar}>
                            <i style={{ width: `${Math.max(4, share * 100)}%` }} />
                          </span>
                          <span className={gameNumbers}>{t.gameRow(g.minutes, g.drops)}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {totals.games.length > GAMES_SHOWN && (
                  <button
                    type="button"
                    className={`${btn} ${btnSmall} ${ghost}`}
                    onClick={() => setAllGames(!allGames)}
                  >
                    {allGames ? t.showFewerGames : t.showAllGames(totals.games.length)}
                  </button>
                )}
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  )
}
