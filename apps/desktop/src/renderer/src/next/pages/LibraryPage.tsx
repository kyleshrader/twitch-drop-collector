// The Library: every game in the user's campaigns, grouped and searchable, and a page per game.
// Games and their grouping come from library.ts; this file only draws them.
import { imageSrc, type CampaignView, type KnownGameView } from '@tdc/ipc-contract'
import { useId, useState, type ReactNode } from 'react'
import { huesOf } from '../art'
import {
  MIN_SEARCH,
  searchedGames,
  useGameList,
  useGameSearch,
  useNow,
  useOpenExternal,
  usePastCampaigns,
  type ListChoice
} from '../data'
import { useSettings } from '../../live'
import { DropList, ExpandButton } from '../DropList'
import { fullDate, shortDate } from '../format'
import { icons, type Icon as IconType } from '../icons'
import { Cover, ListControl, Popover } from '../parts'
import { routeHref } from '../router'
import { strings } from '../strings'
import ui from '../ui.module.css'
import {
  accountOf,
  applyFilters,
  breakdown,
  countStatus,
  FILTERS,
  findGame,
  gameFromName,
  gamesOf,
  groupGames,
  SORTINGS,
  statusOf,
  twitchPageOf,
  type CampaignStatus,
  type Filter,
  type GameGroup,
  type LibraryGame,
  type Sorting
} from './library'
import styles from './Pages.module.css'

const t = strings.library
const Icon = icons
const {
  library,
  side,
  sideTop,
  sideHome,
  sideRow,
  quickFilters,
  search,
  searchEnd,
  sideList,
  groupHead,
  groupToggle,
  groupLink,
  sideGame,
  sideCount,
  libraryMain,
  home,
  shelfHead,
  grid,
  tile,
  tileName,
  tileSub,
  dim,
  gameBanner,
  art,
  shade,
  backLink,
  gameHead,
  gameTitle,
  gameSub,
  gameBar,
  label,
  gameBody,
  tableWrap,
  table,
  status: statusClass,
  footnote,
  campaignCell,
  dropsRow
} = styles
const statusStyles: Record<CampaignStatus, string> = {
  active: styles['active'] ?? '',
  upcoming: styles['upcoming'] ?? '',
  unclaimed: styles['unclaimed'] ?? '',
  completed: styles['completed'] ?? '',
  partial: styles['partial'] ?? '',
  missed: styles['missed'] ?? ''
}
const {
  btn,
  btnSmall,
  glass,
  chip,
  iconButton,
  small,
  menuItem,
  check,
  popHeading,
  note,
  coverMd,
  coverFill,
  empty,
  muted,
  grow,
  selectable
} = ui

const FILTER_ICONS: Record<Filter, IconType> = {
  hideExcluded: Icon.hideExcluded,
  active: Icon.play,
  recentlyClaimed: Icon.clock,
  unclaimed: Icon.reward
}

const summaryOf = (g: LibraryGame): string => {
  const { counts, unlisted } = breakdown(g)
  return t.breakdown(g.seen, counts, unlisted)
}

/** A campaign's row in the game's table, and its drops below it when expanded. */
function CampaignRows(props: { campaign: CampaignView; now: number }): ReactNode {
  const { campaign: c, now } = props
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const status = statusOf(c)
  return (
    <>
      <tr>
        <td>
          <span className={`${statusClass} ${statusStyles[status]}`}>{t.status[status]}</span>
        </td>
        <td>
          <span className={campaignCell}>
            <ExpandButton
              campaign={c.name}
              expanded={expanded}
              controls={listId}
              onToggle={() => setExpanded((was) => !was)}
            />
            <b className={selectable} style={{ fontWeight: 600 }}>
              {c.name}
            </b>
            {c.archived && (
              <span
                className={chip}
                data-tip={c.lastSeenAt ? t.lastSeen(fullDate(c.lastSeenAt)) : undefined}
              >
                {t.noLongerListed}
              </span>
            )}
          </span>
        </td>
        <td className={muted}>
          {shortDate(c.startsAt)} – {shortDate(c.endsAt)}
        </td>
        <td>{strings.upNext.drops(c.drops.filter((d) => d.claimed).length, c.drops.length)}</td>
      </tr>
      {expanded && (
        <tr className={dropsRow}>
          <td colSpan={4}>
            <DropList id={listId} campaign={c} now={now} />
          </td>
        </tr>
      )}
    </>
  )
}

function GamePage(props: { game: LibraryGame | undefined; now: number }): ReactNode {
  const { game, now } = props
  const { listOf, setList } = useGameList()
  const openExternal = useOpenExternal()
  if (!game) {
    return (
      <div className={empty} style={{ margin: 28 }}>
        {t.notFound}
      </div>
    )
  }
  const account = accountOf(game)
  const campaigns = [...game.campaigns].sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  return (
    <>
      <div className={gameBanner} style={huesOf(game.name)}>
        <div className={art}>{game.boxArtUrl && <img src={imageSrc(game.boxArtUrl)} alt="" />}</div>
        <div className={shade} />
        <a
          className={`${btn} ${btnSmall} ${glass} ${backLink}`}
          href={routeHref({ page: 'library' })}
        >
          <Icon.back />
          {t.back}
        </a>
        <div className={gameHead}>
          <Cover game={game.name} url={game.boxArtUrl} size={coverMd} />
          <div>
            <h2 className={gameTitle}>{game.name}</h2>
            <div className={gameSub}>
              {t.recorded(game.seen, game.campaigns.filter((c) => !c.archived).length)}
            </div>
          </div>
        </div>
      </div>
      <div className={gameBar}>
        <span className={label}>{t.listLabel}</span>
        <ListControl
          game={game.name}
          value={listOf(game.name)}
          onChange={(v) => setList(game.name, v)}
        />
        {game.campaigns.length > 0 && (
          <span className={label} style={{ marginLeft: 12 }}>
            {t.accountLabel}
          </span>
        )}
        {game.campaigns.length === 0 ? null : account === 'linked' ? (
          <span className={chip}>
            <Icon.check />
            {t.accountLinked}
          </span>
        ) : account === 'notLinked' && game.linkUrl ? (
          <button
            type="button"
            className={`${btn} ${btnSmall}`}
            onClick={() => openExternal(game.linkUrl!)}
          >
            <Icon.external />
            {t.linkOnTwitch}
          </button>
        ) : (
          <span className={chip}>{t.noLinkNeeded}</span>
        )}
        <span className={grow} />
        <button
          type="button"
          className={`${btn} ${btnSmall}`}
          onClick={() => openExternal(twitchPageOf(game))}
        >
          <Icon.external />
          {t.viewOnTwitch}
        </button>
      </div>
      <div className={gameBody}>
        <h3>{t.campaignsHeading}</h3>
        {game.campaigns.length === 0 && <p className={muted}>{t.noCampaigns}</p>}
        <div className={tableWrap} hidden={game.campaigns.length === 0}>
          <table className={table}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>{t.columns.status}</th>
                <th>{t.columns.campaign}</th>
                <th>{t.columns.dates}</th>
                <th>{t.columns.drops}</th>
              </tr>
            </thead>
            <tbody data-keys="list">
              {campaigns.map((c) => (
                <CampaignRows key={c.id} campaign={c} now={now} />
              ))}
            </tbody>
          </table>
        </div>
        {game.seen > game.campaigns.length && (
          <p className={footnote}>{t.historyNote(game.seen - game.campaigns.length)}</p>
        )}
      </div>
    </>
  )
}

/** A game's row in the sidebar. */
function SideGame(props: { game: LibraryGame; current: boolean; count?: boolean }): ReactNode {
  const { game: g, current, count = true } = props
  return (
    <a
      className={sideGame}
      href={routeHref({ page: 'library', gameId: g.id })}
      aria-current={current ? 'page' : undefined}
    >
      <Cover game={g.name} url={g.boxArtUrl} size="" />
      <span>{g.name}</span>
      {count && (
        <span className={sideCount} data-tip={summaryOf(g)} aria-label={summaryOf(g)}>
          {g.seen}
        </span>
      )}
    </a>
  )
}

/** A heading in the sidebar: the +/− collapses it; its name shows just its games. */
function SideGroup(props: {
  group: GameGroup
  gameId: string | undefined
  current: boolean
  collapsed: boolean
  onToggle: () => void
}): ReactNode {
  const { group, gameId, current, collapsed, onToggle } = props
  const listId = useId()
  const name = t.headings[group.key]
  return (
    <div>
      <div className={groupHead}>
        <button
          type="button"
          className={groupToggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={collapsed ? t.expandGroup(name) : t.collapseGroup(name)}
          onClick={onToggle}
        >
          <span aria-hidden="true">{collapsed ? '+' : '−'}</span>
        </button>
        <a
          className={groupLink}
          href={routeHref({ page: 'library', group: group.key })}
          aria-current={current ? 'page' : undefined}
        >
          {name} <span>({group.games.length})</span>
        </a>
      </div>
      <div id={listId} hidden={collapsed}>
        {group.games.map((g) => (
          <SideGame key={g.id} game={g} current={gameId === g.id} />
        ))}
      </div>
    </div>
  )
}

/** A heading's games as tiles, on the Library's home. */
function Shelf(props: {
  label: string
  games: readonly LibraryGame[]
  note?: string
  listOf: (game: string) => ListChoice
}): ReactNode {
  const { label, games, note: shelfNote, listOf } = props
  return (
    <section aria-label={label}>
      <div className={shelfHead}>
        {label}
        <span>{t.games(games.length)}</span>
      </div>
      {shelfNote && <p className={note}>{shelfNote}</p>}
      <div className={grid} data-keys="grid">
        {games.map((g) => (
          <a
            key={g.id}
            className={`${tile} ${listOf(g.name) === 'excluded' ? dim : ''}`}
            href={routeHref({ page: 'library', gameId: g.id })}
          >
            <Cover game={g.name} url={g.boxArtUrl} size={coverFill} />
            <div className={tileName}>{g.name}</div>
            <div className={tileSub} title={summaryOf(g)}>
              {t.tile(g.seen, countStatus(g, 'active'), countStatus(g, 'unclaimed'))}
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

function toggled<T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> {
  const next = new Set(set)
  if (!next.delete(item)) next.add(item)
  return next
}

export function LibraryPage(props: {
  campaigns: readonly CampaignView[]
  seenByGame: Readonly<Record<string, number>> | undefined
  /** What the app knows about games by name (box art, address), saved and refreshed. */
  games: Readonly<Record<string, KnownGameView>> | undefined
  gameId: string | undefined
  /** Show only this heading's games. */
  group: string | undefined
}): ReactNode {
  const { campaigns, seenByGame, gameId, group: shownGroup } = props
  // Saved info first; this session's searches fill in games not saved yet.
  const known = new Map<string, KnownGameView>([
    ...searchedGames,
    ...Object.entries(props.games ?? {})
  ])
  const settings = useSettings()
  const { listOf } = useGameList()
  const now = useNow()
  const [sorting, setSorting] = useState<Sorting>('list')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ReadonlySet<Filter>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const listed = [...(settings?.mining.priority ?? []), ...(settings?.mining.exclude ?? [])]
  // Twitch's current campaigns and the app's copies of the ones it no longer lists.
  const past = usePastCampaigns()
  const all = gamesOf(campaigns.concat(past), seenByGame, listed, known)
  const q = query.trim().toLowerCase()
  const games = applyFilters(
    all.filter((g) => !q || g.name.toLowerCase().includes(q)),
    filters,
    listOf,
    now
  )
  const groups = groupGames(games, sorting, listOf, now)
  // Twitch's games for the search, less the ones already in the Library.
  const twitch = useGameSearch(query)
  const inLibrary = new Set(all.map((g) => g.name.toLowerCase()))
  const found = twitch.results
    .filter((r) => !inLibrary.has(r.name.toLowerCase()))
    .map(({ name, ...info }) => gameFromName(name, info))
  const searched = q.length >= MIN_SEARCH
  const shelves = shownGroup ? groups.filter((g) => g.key === shownGroup) : groups
  const nothing = groups.length === 0 && found.length === 0 && !(searched && twitch.searching)

  return (
    <div className={library}>
      <aside className={side} aria-label={t.label}>
        <div className={sideTop}>
          <a
            className={sideHome}
            href={routeHref({ page: 'library' })}
            aria-current={gameId || shownGroup ? undefined : 'page'}
          >
            <Icon.home />
            {t.home}
          </a>
          <div className={sideRow}>
            <Popover
              label={t.collection}
              buttonClass={`${btn} ${btnSmall}`}
              button={
                <>
                  {t.collection}
                  <Icon.down />
                </>
              }
            >
              {() => (
                <>
                  <button type="button" className={menuItem}>
                    <span className={check}>
                      <Icon.check />
                    </span>
                    {t.collection}
                  </button>
                  <div className={note}>{t.collectionNote}</div>
                </>
              )}
            </Popover>
            <span className={quickFilters} data-keys="row">
              {FILTERS.map((f) => {
                const FilterIcon = FILTER_ICONS[f]
                return (
                  <button
                    key={f}
                    type="button"
                    className={`${iconButton} ${small}`}
                    aria-pressed={filters.has(f)}
                    aria-label={t.filterNames[f]}
                    data-tip={t.filterNames[f]}
                    onClick={() => setFilters((was) => toggled(was, f))}
                  >
                    <FilterIcon />
                  </button>
                )
              })}
            </span>
          </div>
          <div className={sideRow}>
            <label className={search}>
              <Icon.search />
              <input
                type="search"
                placeholder={`${t.search}`}
                aria-label={t.search}
                aria-keyshortcuts="Control+F"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span className={searchEnd}>
              <Popover
                label={t.sortLabel}
                buttonClass={`${iconButton} ${small}`}
                button={<Icon.sort />}
                tip={`${t.sortLabel}: ${t.sortings[sorting]}`}
                // The button sits at the sidebar's right edge: open rightwards, over the list and
                // the page, rather than off the window to the left.
                align="start"
                width={270}
              >
                {(close) => (
                  <>
                    <div className={popHeading}>{t.sortLabel}</div>
                    {SORTINGS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={menuItem}
                        onClick={() => {
                          setSorting(s)
                          close()
                        }}
                      >
                        <span className={check}>{sorting === s && <Icon.check />}</span>
                        {t.sortings[s]}
                      </button>
                    ))}
                  </>
                )}
              </Popover>
            </span>
          </div>
        </div>
        <nav className={sideList} aria-label={t.label} data-keys="list">
          {nothing && <div className={note}>{t.noMatch}</div>}
          {groups.map((group) => (
            <SideGroup
              key={group.key}
              group={group}
              gameId={gameId}
              current={!gameId && shownGroup === group.key}
              collapsed={collapsed.has(group.key)}
              onToggle={() => setCollapsed((was) => toggled(was, group.key))}
            />
          ))}
          {searched && (
            <div role="group" aria-label={t.onTwitch}>
              <div className={groupHead}>
                <span className={groupLink}>
                  {t.onTwitch} {found.length > 0 && <span>({found.length})</span>}
                </span>
              </div>
              {twitch.searching && found.length === 0 && <div className={note}>{t.searching}</div>}
              {twitch.failed && <div className={note}>{t.searchFailed}</div>}
              {found.map((g) => (
                <SideGame key={g.id} game={g} current={gameId === g.id} count={false} />
              ))}
            </div>
          )}
        </nav>
      </aside>
      <div className={libraryMain}>
        {gameId ? (
          <GamePage game={findGame(all, gameId, known)} now={now} />
        ) : (
          <div className={home}>
            {shelves.length === 0 && found.length === 0 && (
              <div className={empty} style={{ marginTop: 20 }}>
                {t.noMatch}
              </div>
            )}
            {shelves.map((group) => (
              <Shelf
                key={group.key}
                label={t.headings[group.key]}
                games={group.games}
                listOf={listOf}
              />
            ))}
            {!shownGroup && found.length > 0 && (
              <Shelf label={t.onTwitch} games={found} note={t.onTwitchNote} listOf={listOf} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
