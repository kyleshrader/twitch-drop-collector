// The Drops page, laid out like a downloads page: Current, Up next, Upcoming, Completed.
import type { CampaignView, DropView, MinerView, SettingsView } from '@tdc/ipc-contract'
import { imageSrc } from '@tdc/ipc-contract'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { huesOf } from '../art'
import {
  useGameList,
  useLocalSet,
  useNow,
  useOpenExternal,
  useStoredFlag,
  type ListChoice
} from '../data'
import { DropList, ExpandButton } from '../DropList'
import { duration, fullDate, minutesUntil, shortDate, whenLabel } from '../format'
import { icons } from '../icons'
import { Cover, ListControl, SectionTitle, Truncated } from '../parts'
import { routeHref } from '../router'
import { strings } from '../strings'
import ui from '../ui.module.css'
import { Current } from './Current'
import styles from './Drops.module.css'
import { UpNext } from './UpNext'

const Icon = icons
const {
  section,
  sectionLast,
  sectionHead,
  count,
  spacer,
  list,
  excludedHead,
  row,
  rowExcluded,
  rowTitle,
  rowSub,
  starts,
  when,
  hiddenNote,
  reward,
  rewardSmall,
  rowWrap,
  rowDrops
} = styles
const {
  btn,
  btnSmall,
  ghost,
  blue,
  claimed: claimedClass,
  iconButton,
  small,
  empty,
  coverXs,
  grow,
  flash
} = ui

function ExcludedToggle(props: { n: number; open: boolean; onToggle: () => void }): ReactNode {
  if (props.n === 0) return null
  return (
    <button
      type="button"
      className={`${btn} ${btnSmall} ${ghost}`}
      aria-expanded={props.open}
      onClick={props.onToggle}
    >
      {props.open ? strings.upNext.hideExcluded(props.n) : strings.upNext.showExcluded(props.n)}
    </button>
  )
}

function UpcomingRow(props: {
  campaign: CampaignView
  excluded: boolean
  list: ListChoice
  onList: (choice: ListChoice) => void
  now: number
}): ReactNode {
  const { campaign: c, excluded, now } = props
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  return (
    <div className={rowWrap} data-key-card data-target={c.id}>
      <div className={`${row} ${excluded ? rowExcluded : ''}`}>
        <ExpandButton
          campaign={c.name}
          expanded={expanded}
          controls={listId}
          onToggle={() => setExpanded((was) => !was)}
        />
        <Cover game={c.game} url={c.boxArtUrl} size={coverXs} />
        <div className={grow}>
          <Truncated text={c.game} className={rowTitle} />
          <Truncated text={c.name} className={rowSub} selectable />
        </div>
        <span className={starts} data-tip={fullDate(c.startsAt)}>
          <Icon.clock />
          {strings.upcoming.startsIn} <b>{duration(minutesUntil(c.startsAt, now))}</b>
        </span>
        <ListControl game={c.game} value={props.list} onChange={props.onList} />
      </div>
      {expanded && (
        <div className={rowDrops}>
          <DropList id={listId} campaign={c} now={now} />
        </div>
      )}
    </div>
  )
}

function Upcoming(props: { campaigns: readonly CampaignView[]; now: number }): ReactNode {
  const t = strings.upcoming
  const { listOf, setList } = useGameList()
  const [showExcluded, setShowExcluded] = useState(false)
  const [collapsed, setCollapsed] = useStoredFlag('tdc.next.collapsed.upcoming')
  const bodyId = useId()
  const upcoming = props.campaigns
    .filter((c) => c.state === 'upcoming')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const shown = upcoming.filter((c) => listOf(c.game) !== 'excluded')
  const excluded = upcoming.filter((c) => listOf(c.game) === 'excluded')
  const rowOf = (c: CampaignView, isExcluded: boolean): ReactNode => (
    <UpcomingRow
      key={c.id}
      campaign={c}
      excluded={isExcluded}
      list={listOf(c.game)}
      onList={(v) => setList(c.game, v)}
      now={props.now}
    />
  )
  return (
    <section className={section} aria-label={t.label}>
      <div className={sectionHead}>
        <SectionTitle
          label={t.label}
          collapsed={collapsed}
          controls={bodyId}
          onToggle={() => setCollapsed(!collapsed)}
        />
        <span className={count}>{shown.length}</span>
        <span className={spacer} />
        {!collapsed && (
          <ExcludedToggle
            n={excluded.length}
            open={showExcluded}
            onToggle={() => setShowExcluded((was) => !was)}
          />
        )}
      </div>
      <div id={bodyId} hidden={collapsed}>
        <div className={list} data-keys="cards">
          {shown.length === 0 && <div className={empty}>{t.empty}</div>}
          {shown.map((c) => rowOf(c, false))}
        </div>
        {showExcluded && excluded.length > 0 && (
          <>
            <div className={excludedHead}>
              <Icon.excluded />
              {strings.upNext.excludedHeading}
            </div>
            <div className={list} data-keys="cards">
              {excluded.map((c) => rowOf(c, true))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

interface Done {
  key: string
  drop: DropView
  campaign: CampaignView
}

function Completed(props: { campaigns: readonly CampaignView[]; now: number }): ReactNode {
  const t = strings.completed
  const { listOf } = useGameList()
  const openExternal = useOpenExternal()
  const hidden = useLocalSet('tdc.next.completedHidden')
  const [showExcluded, setShowExcluded] = useState(false)
  const [collapsed, setCollapsed] = useStoredFlag('tdc.next.collapsed.completed')
  const bodyId = useId()
  // Newest claims first; drops without a claim time (claimed before the app kept one, or
  // waiting for a linked account) follow, newest campaigns first.
  const all: Done[] = props.campaigns
    .flatMap((campaign) =>
      campaign.drops
        .filter((d) => d.claimed || d.awaitsConnection)
        .map((drop) => ({ key: `${campaign.id}:${drop.id}`, drop, campaign }))
    )
    .sort(
      (a, b) =>
        (b.drop.claimedAt ?? '').localeCompare(a.drop.claimedAt ?? '') ||
        b.campaign.endsAt.localeCompare(a.campaign.endsAt) ||
        b.drop.requiredMinutes - a.drop.requiredMinutes
    )
  const visible = all.filter((d) => !hidden.has(d.key))
  const shown = visible.filter((d) => listOf(d.campaign.game) !== 'excluded')
  const excluded = visible.filter((d) => listOf(d.campaign.game) === 'excluded')

  const rowOf = (d: Done, isExcluded: boolean): ReactNode => {
    const ended = minutesUntil(d.campaign.endsAt, props.now) <= 0
    return (
      <div
        key={d.key}
        className={`${row} ${isExcluded ? rowExcluded : ''}`}
        data-key-card
        data-target={d.drop.id}
      >
        <span className={`${reward} ${rewardSmall}`} style={huesOf(d.drop.name)} aria-hidden="true">
          {d.drop.imageUrl ? <img src={imageSrc(d.drop.imageUrl)} alt="" /> : <Icon.reward />}
        </span>
        <div className={grow}>
          <Truncated text={d.drop.name} className={rowTitle} selectable />
          <Truncated
            text={t.detail(
              d.drop.rewards.join(', ') || d.drop.name,
              d.campaign.game,
              d.campaign.name
            )}
            className={rowSub}
            selectable
          />
        </div>
        <span className={when}>
          {d.drop.claimedAt
            ? whenLabel(d.drop.claimedAt, props.now)
            : ended
              ? t.ended(shortDate(d.campaign.endsAt))
              : t.ends(shortDate(d.campaign.endsAt))}
        </span>
        {d.drop.awaitsConnection && d.campaign.linkUrl ? (
          <button
            type="button"
            className={`${btn} ${blue}`}
            onClick={() => openExternal(d.campaign.linkUrl!)}
          >
            <Icon.link />
            {t.linkToClaim}
          </button>
        ) : (
          <button type="button" className={`${btn} ${claimedClass}`} disabled>
            <Icon.check />
            {t.claimed}
          </button>
        )}
        <button
          type="button"
          className={`${iconButton} ${small}`}
          aria-label={t.hideLabel(d.drop.name)}
          data-tip={t.hide}
          onClick={() => hidden.add([d.key])}
        >
          <Icon.close />
        </button>
      </div>
    )
  }

  return (
    <section className={`${section} ${sectionLast}`} aria-label={t.label}>
      <div className={sectionHead}>
        <SectionTitle
          label={t.label}
          collapsed={collapsed}
          controls={bodyId}
          onToggle={() => setCollapsed(!collapsed)}
        />
        <span className={count}>{shown.length}</span>
        <span className={spacer} />
        {!collapsed && shown.length > 0 && (
          <button
            type="button"
            className={`${btn} ${btnSmall} ${ghost}`}
            onClick={() => hidden.add(shown.map((d) => d.key))}
          >
            {t.clearAll}
          </button>
        )}
        {!collapsed && (
          <ExcludedToggle
            n={excluded.length}
            open={showExcluded}
            onToggle={() => setShowExcluded((was) => !was)}
          />
        )}
      </div>
      <div id={bodyId} hidden={collapsed}>
        <div className={list} data-keys="cards">
          {shown.length === 0 && <div className={empty}>{t.empty}</div>}
          {shown.map((d) => rowOf(d, false))}
        </div>
        {hidden.size > 0 && (
          <div className={hiddenNote}>
            {t.hidden(hidden.size)}
            <button type="button" className={`${btn} ${btnSmall} ${ghost}`} onClick={hidden.clear}>
              <Icon.undo />
              {t.undo}
            </button>
          </div>
        )}
        {showExcluded && excluded.length > 0 && (
          <>
            <div className={excludedHead}>
              <Icon.excluded />
              {strings.upNext.excludedHeading}
            </div>
            <div className={list} data-keys="cards">
              {excluded.map((d) => rowOf(d, true))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** How long the item a notification opened stays highlighted. */
const FLASH_MS = 1600

/**
 * Scrolls to the campaign or drop a notification named (a [data-target] element), focuses it and
 * highlights it briefly; then the address goes back to plain #/drops, so the same notification
 * works again.
 */
/** Back to plain #/drops without a history entry, telling the router (replaceState doesn't). */
function clearTarget(): void {
  window.history.replaceState(null, '', routeHref({ page: 'drops' }))
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function useScrollToTarget(target: string | undefined, ready: boolean): void {
  useEffect(() => {
    if (!target || !ready) return
    let tries = 0
    let frame = 0
    let timer = 0
    const find = (): void => {
      const el = document.querySelector<HTMLElement>(`[data-target="${CSS.escape(target)}"]`)
      if (!el) {
        if (++tries < 30) frame = requestAnimationFrame(find)
        else clearTarget()
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      if (!el.hasAttribute('tabindex')) el.tabIndex = -1
      el.focus({ preventScroll: true })
      el.classList.add(flash ?? '')
      timer = window.setTimeout(() => el.classList.remove(flash ?? ''), FLASH_MS)
      clearTarget()
    }
    frame = requestAnimationFrame(find)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [target, ready])
}

export function DropsPage(props: {
  miner: MinerView | undefined
  settings: SettingsView
  /** A campaign or drop to scroll to. */
  target?: string | undefined
}): ReactNode {
  const { miner, settings } = props
  const now = useNow()
  useScrollToTarget(props.target, miner !== undefined)
  return (
    <>
      <Current miner={miner} now={now} />
      {miner && <UpNext miner={miner} settings={settings} now={now} />}
      {miner && <Upcoming campaigns={miner.campaigns} now={now} />}
      {miner && <Completed campaigns={miner.campaigns} now={now} />}
    </>
  )
}
