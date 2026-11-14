// Up next: the queue (docs/new-ui/queue-rules.md). Main builds the pieces from the order; every
// change here sends a whole new order (or a sort, layout or focus) through settings:update.
import type {
  CampaignView,
  MinerView,
  QueueEntryView,
  QueuePieceView,
  SettingsPatchInput,
  SettingsView
} from '@tdc/ipc-contract'
import { useId, useState, type DragEvent, type ReactNode } from 'react'
import {
  customOrderPatch,
  useGameList,
  useOpenExternal,
  useSettingsPatch,
  useStoredFlag
} from '../data'
import { DropList, ExpandButton } from '../DropList'
import { minutesUntil } from '../format'
import { icons } from '../icons'
import { navigate } from '../router'
import { ChannelLink, Cover, ListChip, Popover, SectionTitle, Truncated } from '../parts'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Drops.module.css'
import {
  dropOn,
  movePiece,
  splitMove,
  takenBy,
  toTop,
  type DropTarget,
  type PieceIds
} from './queue-ops'

const t = strings.upNext
const Icon = icons
const {
  section,
  sectionHead,
  count,
  spacer,
  list,
  excludedHead,
  notice,
  card,
  cardFlat,
  dragging: draggingClass,
  dropBefore,
  dropAfter,
  grip,
  cardHead,
  gameName,
  channels: channelsClass,
  campaign: campaignClass,
  campaignFlat,
  campaignGrip,
  campaignName,
  nameLine,
  campaignDrops,
  mini,
  campaignTime,
  campaignActions,
  warning: warningClass,
  dropsPanel,
  hint,
  row,
  rowExcluded,
  rowTitle,
  rowSub,
  groupBy: groupByClass,
  sortOption,
  sortText,
  sortDesc,
  sortStatic,
  sortSetting
} = styles
const {
  btn,
  btnSmall,
  ghost,
  iconButton,
  small,
  chip,
  chipAccent,
  chipNew,
  chipWarn,
  segmented,
  menuItem,
  check,
  popHeading,
  separator,
  alert,
  empty,
  coverSm,
  coverXs,
  muted,
  grow,
  selectable
} = ui

type Layout = SettingsView['queue']['layout']
type Direction = -1 | 1
const LAYOUTS: readonly Layout[] = ['games', 'campaigns']
const NEW_IN_CUSTOM = ['byTimeRemaining', 'end'] as const

/** Which channels count for a campaign: the same key for the same allow-list. */
const channelsKey = (c: CampaignView): string => [...c.allowedChannels].sort().join('\n')
const AUTO_SORTS = ['priority', 'ending', 'spare'] as const

interface Moves {
  movePiece(key: string, direction: Direction): void
  splitMove(key: string, campaignId: string, direction: Direction): void
  collect(campaignId: string): void
}

interface Drag {
  key: string
  ids: readonly string[]
}

const idsOf = (p: QueuePieceView): PieceIds => ({
  key: p.key,
  ids: p.entries.map((e) => e.campaignId)
})

function LinkChip(props: {
  piece: QueuePieceView
  byId: ReadonlyMap<string, CampaignView>
}): ReactNode {
  const { piece, byId } = props
  if (piece.entries.some((e) => e.notMined === 'notLinked')) {
    return (
      <span className={`${chip} ${chipWarn}`} data-tip={t.notLinkedTip}>
        <Icon.link />
        {t.notLinked}
      </span>
    )
  }
  const linked = piece.entries.some((e) => {
    const c = byId.get(e.campaignId)
    return c?.linked && !c.badgesEmotes
  })
  return linked ? (
    <span className={chip} data-tip={t.linkedTip}>
      <Icon.link />
      {t.linked}
    </span>
  ) : null
}

function CampaignRow(props: {
  piece: QueuePieceView
  entry: QueueEntryView
  campaign: CampaignView
  layout: Layout
  canSplit: boolean
  /** The card's campaigns accept different channels, so each row says which. */
  showChannels: boolean
  first: boolean
  last: boolean
  now: number
  names: (ids: readonly string[]) => string[]
  moves: Moves
  onDragStart: (event: DragEvent, campaignId: string) => void
  onDragEnd: () => void
}): ReactNode {
  const { piece, entry, campaign: c, layout, canSplit, first, last, now, names, moves } = props
  const openExternal = useOpenExternal()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const flat = layout === 'campaigns'
  const multi = piece.entries.length > 1
  const index = piece.entries.indexOf(entry)
  const endsIn = minutesUntil(c.endsAt, now)
  const claimed = c.drops.filter((d) => d.claimed).length
  const percent = c.drops.length ? (claimed / c.drops.length) * 100 : 0
  // A move from inside a card splits it when there's something on the other side to leave.
  const splitsUp = canSplit && multi && index < piece.entries.length - 1
  const splitsDown = canSplit && multi && index > 0
  const move = (direction: Direction): void =>
    (direction < 0 ? splitsUp : splitsDown)
      ? moves.splitMove(piece.key, entry.campaignId, direction)
      : moves.movePiece(piece.key, direction)

  return (
    <div
      className={`${campaignClass} ${flat ? campaignFlat : ''}`}
      data-testid="queue-campaign"
      data-target={entry.campaignId}
      data-key-card
    >
      {!flat && (
        <span
          className={campaignGrip}
          draggable={canSplit && multi}
          data-tip={canSplit && multi ? t.dragCampaign : undefined}
          onDragStart={(event) => props.onDragStart(event, entry.campaignId)}
          onDragEnd={props.onDragEnd}
        >
          {canSplit && multi && <Icon.grip />}
        </span>
      )}
      <div className={campaignName}>
        <span className={nameLine}>
          <ExpandButton
            campaign={c.name}
            expanded={expanded}
            controls={listId}
            onToggle={() => setExpanded((was) => !was)}
          />
          <Truncated text={c.name} selectable />
        </span>
        {entry.isNew && <span className={`${chip} ${chipNew}`}>{t.newTag}</span>}
        {props.showChannels && <ChannelList campaign={c} />}
      </div>
      <div className={campaignDrops}>
        <div className={mini}>
          <i style={{ width: `${percent}%` }} />
        </div>
        {t.drops(claimed, c.drops.length)}
      </div>
      <div className={campaignTime}>
        {entry.mined ? (
          <>
            <span>{t.needs(entry.needMinutes)}</span>
            <span className={muted}>{t.endsStarts(endsIn, entry.startsInMinutes)}</span>
          </>
        ) : (
          <span className={`${muted} ${selectable}`}>
            {t.notMined[entry.notMined ?? 'notLinked']}
          </span>
        )}
      </div>
      <div className={campaignActions}>
        {entry.mined ? (
          <button
            type="button"
            className={`${btn} ${btnSmall}`}
            onClick={() => moves.collect(entry.campaignId)}
          >
            <Icon.collect />
            {t.collect}
          </button>
        ) : (
          entry.notMined === 'notLinked' &&
          c.linkUrl && (
            <button
              type="button"
              className={`${btn} ${btnSmall}`}
              onClick={() => openExternal(c.linkUrl!)}
            >
              <Icon.external />
              {t.linkAccount}
            </button>
          )
        )}
        <Popover
          label={t.campaignActions(c.name)}
          buttonClass={`${iconButton} ${small}`}
          button={<Icon.more />}
          align="end"
          width={300}
        >
          {(close) => (
            <>
              <div className={popHeading}>{c.name}</div>
              <button
                type="button"
                className={menuItem}
                disabled={first && !splitsUp}
                onClick={() => {
                  move(-1)
                  close()
                }}
              >
                <Icon.up />
                {splitsUp ? t.splitUp : t.moveUp}
              </button>
              <button
                type="button"
                className={menuItem}
                disabled={last && !splitsDown}
                onClick={() => {
                  move(1)
                  close()
                }}
              >
                <Icon.dn />
                {splitsDown ? t.splitDown : t.moveDown}
              </button>
              {entry.mined && (
                <>
                  <hr className={separator} />
                  <button
                    type="button"
                    className={menuItem}
                    onClick={() => {
                      moves.collect(entry.campaignId)
                      close()
                    }}
                  >
                    <Icon.collect />
                    {t.collect}
                  </button>
                </>
              )}
            </>
          )}
        </Popover>
      </div>
      {entry.warning && (
        <div className={`${alert} ${warningClass} ${selectable}`} role="note">
          <Icon.warning />
          <div>
            {t.wontFinish(entry.needMinutes, endsIn)}{' '}
            {entry.warning.savedAtTop ? t.savedAtTop : t.lostAnyway}
          </div>
        </div>
      )}
      {entry.progressesWith.length > 0 && (
        <div className={`${hint} ${selectable}`}>
          {t.progressesWith(names(entry.progressesWith))}
        </div>
      )}
      {expanded && (
        <div className={dropsPanel}>
          <DropList id={listId} campaign={c} now={now} />
        </div>
      )}
    </div>
  )
}

/** "Only on a, b, c and 2 more", each name opening its channel on Twitch. */
function ChannelNames(props: { campaign: CampaignView }): ReactNode {
  const { allowedChannels: names, allowedLogins: logins = [] } = props.campaign
  const shown = names.slice(0, t.onlyOnShown)
  return (
    <>
      {t.onlyOn}{' '}
      {shown.map((name, i) => (
        <span key={name}>
          {i > 0 && ', '}
          <ChannelLink login={logins[i] ?? name} name={name} />
        </span>
      ))}
      {names.length > shown.length && t.andMore(names.length - shown.length)}
    </>
  )
}

/** Which channels count: "Only on …" for a creator campaign, else "Any channel". */
function ChannelList(props: { campaign: CampaignView }): ReactNode {
  const c = props.campaign
  const limited = c.allowedChannels.length > 0
  return (
    <span
      className={`${channelsClass} ${selectable}`}
      data-testid="queue-channels"
      data-tip={
        !limited
          ? t.anyChannelTip
          : c.allowedChannels.length > t.onlyOnShown
            ? t.channelTip(c.allowedChannels)
            : undefined
      }
    >
      <Icon.channel />
      <span>{limited ? <ChannelNames campaign={c} /> : t.anyChannel}</span>
    </span>
  )
}

function QueueCard(props: {
  piece: QueuePieceView
  byId: ReadonlyMap<string, CampaignView>
  layout: Layout
  canSplit: boolean
  index: number
  total: number
  currentGame: string | undefined
  now: number
  moves: Moves
  drag: Drag | undefined
  target: DropTarget | undefined
  onDrag: (drag: Drag | undefined) => void
  onTarget: (target: DropTarget | undefined) => void
  onDrop: () => void
}): ReactNode {
  const { piece, byId, layout, canSplit, index, total, currentGame, now, moves } = props
  const { listOf, setList } = useGameList()
  const flat = layout === 'campaigns'
  const first = byId.get(piece.entries[0]!.campaignId)
  const campaigns = piece.entries.flatMap((e) => byId.get(e.campaignId) ?? [])
  // One channel list for the whole card goes in its header; different ones go on each row.
  const sameChannels = campaigns.every((c) => first && channelsKey(c) === channelsKey(first))
  const choice = listOf(piece.game)
  const names = (ids: readonly string[]): string[] => ids.map((id) => byId.get(id)?.name ?? id)
  const isTarget = props.target?.key === piece.key
  const startDrag = (event: DragEvent, ids: readonly string[]): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', ids.join(','))
    props.onDrag({ key: piece.key, ids })
  }

  return (
    <div
      className={[
        card,
        flat ? cardFlat : '',
        props.drag?.key === piece.key ? draggingClass : '',
        isTarget ? (props.target?.where === 'before' ? dropBefore : dropAfter) : ''
      ].join(' ')}
      data-testid="queue-card"
      data-key-card
      aria-label={piece.game}
      role="group"
      onDragOver={(event) => {
        if (!props.drag) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        const where = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
        if (!isTarget || props.target?.where !== where) props.onTarget({ key: piece.key, where })
      }}
      onDrop={(event) => {
        event.preventDefault()
        props.onDrop()
      }}
    >
      <div
        className={grip}
        draggable
        data-tip={t.drag}
        onDragStart={(event) =>
          startDrag(
            event,
            piece.entries.map((e) => e.campaignId)
          )
        }
        onDragEnd={() => props.onDrag(undefined)}
      >
        <Icon.grip />
      </div>
      <div>
        <Cover game={piece.game} url={first?.boxArtUrl} size={flat ? coverXs : coverSm} />
      </div>
      <div>
        <div className={cardHead}>
          <Truncated text={piece.game} className={gameName} />
          <ListChip value={choice} />
          <LinkChip piece={piece} byId={byId} />
          {piece.focus && (
            <span className={`${chip} ${chipAccent}`}>
              <Icon.collect />
              {t.collecting}
            </span>
          )}
          {piece.game === currentGame && (
            <span className={chip} data-tip={t.alsoCurrentTip}>
              {t.alsoCurrent}
            </span>
          )}
          {piece.split && (
            <span className={chip} data-tip={t.splitTip}>
              {t.split}
            </span>
          )}
          {sameChannels && first && <ChannelList campaign={first} />}
          <span className={grow} />
          <Popover
            label={t.gameActions(piece.game)}
            buttonClass={`${iconButton} ${small}`}
            button={<Icon.more />}
            align="end"
          >
            {(close) => (
              <>
                <div className={popHeading}>{piece.game}</div>
                {(['priority', 'notSet', 'excluded'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={menuItem}
                    onClick={() => {
                      setList(piece.game, value)
                      close()
                    }}
                  >
                    <span className={check}>{choice === value && <Icon.check />}</span>
                    {strings.list[value]}
                  </button>
                ))}
                <hr className={separator} />
                <button
                  type="button"
                  className={menuItem}
                  disabled={index === 0}
                  onClick={() => {
                    moves.movePiece(piece.key, -1)
                    close()
                  }}
                >
                  <Icon.up />
                  {t.moveUp}
                </button>
                <button
                  type="button"
                  className={menuItem}
                  disabled={index === total - 1}
                  onClick={() => {
                    moves.movePiece(piece.key, 1)
                    close()
                  }}
                >
                  <Icon.dn />
                  {t.moveDown}
                </button>
                <hr className={separator} />
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    close()
                    if (first) navigate({ page: 'library', gameId: first.gameId })
                  }}
                >
                  <Icon.external />
                  {t.openInLibrary}
                </button>
              </>
            )}
          </Popover>
        </div>
        {piece.entries.map((entry, i) => {
          const c = byId.get(entry.campaignId)
          if (!c) return null
          return (
            <CampaignRow
              key={entry.campaignId}
              piece={piece}
              entry={entry}
              campaign={c}
              layout={layout}
              canSplit={canSplit}
              showChannels={!sameChannels}
              first={index === 0 && i === 0}
              last={index === total - 1 && i === piece.entries.length - 1}
              now={now}
              names={names}
              moves={moves}
              onDragStart={(event, campaignId) => {
                event.stopPropagation()
                // Which part comes along depends on the direction, known only at the drop; up
                // is assumed until then (the drop works out the real part).
                startDrag(event, [campaignId])
              }}
              onDragEnd={() => props.onDrag(undefined)}
            />
          )
        })}
      </div>
    </div>
  )
}

function SortChoice(props: {
  checked: boolean
  name: string
  note: string
  onPick?: () => void
}): ReactNode {
  const body = (
    <>
      <span className={check}>{props.checked && <Icon.check />}</span>
      <span className={sortText}>
        <span>{props.name}</span>
        <span className={sortDesc}>{props.note}</span>
      </span>
    </>
  )
  // Custom can't be picked: it starts when the user moves something.
  return props.onPick ? (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      className={`${menuItem} ${sortOption}`}
      onClick={props.onPick}
    >
      {body}
    </button>
  ) : (
    <div
      role="radio"
      aria-checked={props.checked}
      aria-disabled
      className={`${menuItem} ${sortOption} ${sortStatic}`}
    >
      {body}
    </div>
  )
}

/** How Up next is sorted, and the two preferences that shape the sorts. */
function SortMenu(props: {
  settings: SettingsView
  onSave: (patch: SettingsPatchInput) => void
}): ReactNode {
  const { sort, baseSort, linkedFirst, newInCustom } = props.settings.queue
  const save = props.onSave
  return (
    <Popover
      label={t.sortLabel}
      buttonClass={`${btn} ${btnSmall}`}
      button={
        <>
          <Icon.sort />
          {t.sortButton(t.sorts[sort])}
          <Icon.down />
        </>
      }
      align="end"
      width={340}
    >
      {(close) => (
        <>
          <div className={popHeading}>{t.sortLabel}</div>
          <div role="radiogroup" aria-label={t.sortLabel}>
            {AUTO_SORTS.map((value) => (
              <SortChoice
                key={value}
                checked={sort === value}
                name={t.sorts[value]}
                note={t.sortNotes[value]}
                onPick={() => {
                  save({ queue: { sort: value, baseSort: value, focus: '' } })
                  close()
                }}
              />
            ))}
            <SortChoice
              checked={sort === 'custom'}
              name={t.sorts.custom}
              note={sort === 'custom' ? t.customFrom(t.sorts[baseSort]) : t.customHow}
            />
          </div>
          <hr className={separator} />
          <div className={popHeading}>{t.sortOptions}</div>
          <button
            type="button"
            role="checkbox"
            aria-checked={linkedFirst}
            className={`${menuItem} ${sortOption}`}
            onClick={() => save({ queue: { linkedFirst: !linkedFirst } })}
          >
            <span className={check}>{linkedFirst && <Icon.check />}</span>
            <span className={sortText}>
              <span>{t.linkedFirst}</span>
              <span className={sortDesc}>{t.linkedFirstNote}</span>
            </span>
          </button>
          <div className={sortSetting}>
            <span>{t.newInCustom}</span>
            <div className={segmented} role="group" aria-label={t.newInCustom} data-keys="row">
              {NEW_IN_CUSTOM.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={newInCustom === value}
                  onClick={() => save({ queue: { newInCustom: value } })}
                >
                  {t.newInCustomOptions[value]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </Popover>
  )
}

function ExcludedRow(props: {
  piece: QueuePieceView
  byId: ReadonlyMap<string, CampaignView>
}): ReactNode {
  const { piece, byId } = props
  const { setList } = useGameList()
  const first = byId.get(piece.entries[0]!.campaignId)
  return (
    <div className={`${row} ${rowExcluded}`} data-key-card>
      <Cover game={piece.game} url={first?.boxArtUrl} size={coverXs} />
      <div className={grow}>
        <Truncated text={piece.game} className={rowTitle} />
        <Truncated
          text={piece.entries.map((e) => byId.get(e.campaignId)?.name).join(', ')}
          className={rowSub}
          selectable
        />
      </div>
      <button
        type="button"
        className={`${btn} ${btnSmall}`}
        onClick={() => setList(piece.game, 'priority')}
      >
        <Icon.up />
        {strings.list.priority}
      </button>
      <button
        type="button"
        className={`${btn} ${btnSmall} ${ghost}`}
        onClick={() => setList(piece.game, 'notSet')}
      >
        {strings.list.notSet}
      </button>
    </div>
  )
}

export function UpNext(props: {
  miner: MinerView
  settings: SettingsView
  now: number
}): ReactNode {
  const { miner, settings, now } = props
  const queue = miner.queue
  const { save } = useSettingsPatch()
  const [showExcluded, setShowExcluded] = useState(false)
  const [drag, setDrag] = useState<Drag>()
  const [target, setTarget] = useState<DropTarget>()
  const [collapsed, setCollapsed] = useStoredFlag('tdc.next.collapsed.upNext')
  const bodyId = useId()
  if (!queue) return null

  const byId = new Map(miner.campaigns.map((c) => [c.id, c]))
  const { layout, sort, baseSort } = settings.queue
  const pieces = queue.pieces.map(idsOf)
  const currentGame = miner.campaigns.find((c) => c.id === miner.active?.campaignId)?.game
  const entries = queue.pieces.reduce((n, p) => n + p.entries.length, 0)
  const reorder = (order: readonly string[] | undefined): void => {
    if (order) save(customOrderPatch(settings, order))
  }
  const moves: Moves = {
    movePiece: (key, direction) => reorder(movePiece(queue.order, pieces, key, direction)),
    splitMove: (key, id, direction) => reorder(splitMove(queue.order, pieces, key, id, direction)),
    collect: (id) =>
      sort === 'custom'
        ? save({ queue: { order: toTop(queue.order, id), focus: '' } })
        : save({ queue: { focus: id } })
  }
  const finishDrag = (): void => {
    if (drag && target && target.key !== drag.key) {
      const from = pieces.findIndex((p) => p.key === drag.key)
      const to = pieces.findIndex((p) => p.key === target.key)
      const source = pieces[from]!
      // A single campaign dragged out of a card takes the ones above (up) or below (down) too.
      const moving =
        drag.ids.length === 1 && source.ids.length > 1
          ? takenBy(source, drag.ids[0]!, to < from ? -1 : 1)
          : drag.ids
      reorder(dropOn(queue.order, pieces, moving, target))
    }
    setDrag(undefined)
    setTarget(undefined)
  }
  const priorityOnly = queue.pieces.some((p) =>
    p.entries.some((e) => e.notMined === 'priorityOnly')
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
        <span className={count}>{entries}</span>
        <span className={spacer} />
        {!collapsed && (
          <>
            <div className={groupByClass}>
              <span aria-hidden>{t.groupBy}</span>
              <div className={segmented} role="group" aria-label={t.groupByLabel} data-keys="row">
                {LAYOUTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={layout === value}
                    data-tip={t.layoutTips[value]}
                    onClick={() => save({ queue: { layout: value } })}
                  >
                    {t.layouts[value]}
                  </button>
                ))}
              </div>
            </div>
            {sort === 'custom' && (
              <button
                type="button"
                className={`${btn} ${btnSmall} ${ghost}`}
                onClick={() => save({ queue: { sort: baseSort } })}
              >
                <Icon.undo />
                {t.reset(t.sorts[baseSort])}
              </button>
            )}
            <SortMenu settings={settings} onSave={save} />
            {queue.excluded.length > 0 && (
              <button
                type="button"
                className={`${btn} ${btnSmall} ${ghost}`}
                aria-expanded={showExcluded}
                onClick={() => setShowExcluded((was) => !was)}
              >
                {showExcluded
                  ? t.hideExcluded(queue.excluded.length)
                  : t.showExcluded(queue.excluded.length)}
              </button>
            )}
          </>
        )}
      </div>
      <div id={bodyId} hidden={collapsed}>
        {priorityOnly && (
          <div className={`${alert} ${notice}`}>
            <Icon.info />
            <span>{t.priorityOnly}</span>
            <button
              type="button"
              className={`${btn} ${btnSmall}`}
              onClick={() => save({ mining: { priorityMode: 'endingSoonest' } })}
            >
              {t.mineNotSet}
            </button>
          </div>
        )}
        <div className={list} data-keys="cards">
          {queue.pieces.length === 0 && <div className={empty}>{t.empty}</div>}
          {queue.pieces.map((piece, index) => (
            <QueueCard
              key={piece.key}
              piece={piece}
              byId={byId}
              layout={layout}
              canSplit={layout !== 'campaigns'}
              index={index}
              total={queue.pieces.length}
              currentGame={currentGame}
              now={now}
              moves={moves}
              drag={drag}
              target={target}
              onDrag={(next) => {
                setDrag(next)
                if (!next) setTarget(undefined)
              }}
              onTarget={setTarget}
              onDrop={finishDrag}
            />
          ))}
        </div>
        {showExcluded && queue.excluded.length > 0 && (
          <>
            <div className={excludedHead}>
              <Icon.excluded />
              {t.excludedHeading}
            </div>
            <div className={list} data-keys="cards">
              {queue.excluded.map((piece) => (
                <ExcludedRow key={piece.key} piece={piece} byId={byId} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
