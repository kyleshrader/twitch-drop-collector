// A campaign's drops, shown when the campaign is expanded (Up next, Upcoming, the Library):
// each drop's reward, progress and state.
import { imageSrc, type CampaignView, type DropView } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { huesOf } from './art'
import { minutesUntil, shortDate } from './format'
import { icons } from './icons'
import { Truncated } from './parts'
import { strings } from './strings'
import ui from './ui.module.css'

const t = strings.dropList
const Icon = icons
const {
  expandButton,
  dropList,
  dropRow,
  dropArt,
  dropText,
  dropName,
  dropRewards,
  dropProgress,
  dropBar,
  dropState,
  dropDone,
  dropWarn,
  muted,
  empty,
  selectable
} = ui

type State = keyof typeof t.status

function stateOf(d: DropView, now: number): State {
  if (d.claimed) return 'claimed'
  if (d.awaitsConnection) return 'awaitsLink'
  if (d.minutes >= d.requiredMinutes) return 'finished'
  if (minutesUntil(d.endsAt, now) <= 0) return 'ended'
  return d.minutes > 0 ? 'inProgress' : 'notStarted'
}

/** The chevron that expands a campaign; `controls` is the ID of the list it shows. */
export function ExpandButton(props: {
  campaign: string
  expanded: boolean
  controls: string
  onToggle: () => void
}): ReactNode {
  const { campaign, expanded, controls, onToggle } = props
  const label = expanded ? t.hide(campaign) : t.show(campaign)
  return (
    <button
      type="button"
      className={expandButton}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      onClick={onToggle}
    >
      <Icon.down />
    </button>
  )
}

export function DropList(props: { id: string; campaign: CampaignView; now: number }): ReactNode {
  const { id, campaign, now } = props
  const drops = [...campaign.drops].sort((a, b) => a.requiredMinutes - b.requiredMinutes)
  if (drops.length === 0) {
    return (
      <div id={id} className={empty}>
        {t.empty}
      </div>
    )
  }
  return (
    <ul id={id} className={dropList} aria-label={t.label(campaign.name)}>
      {drops.map((d) => {
        const state = stateOf(d, now)
        const startsIn = minutesUntil(d.startsAt, now)
        // Drops with their own dates inside the campaign's say so (the same days don't count).
        const ownWindow =
          shortDate(d.startsAt) !== shortDate(campaign.startsAt) ||
          shortDate(d.endsAt) !== shortDate(campaign.endsAt)
        const percent = Math.min(100, (d.minutes / Math.max(1, d.requiredMinutes)) * 100)
        return (
          <li key={d.id} className={dropRow}>
            <span className={dropArt} style={huesOf(d.name)} aria-hidden="true">
              {d.imageUrl ? <img src={imageSrc(d.imageUrl)} alt="" /> : <Icon.reward />}
            </span>
            <div className={dropText}>
              <Truncated text={d.name} className={dropName} selectable />
              {d.rewards.length > 0 && (
                <span className={`${dropRewards} ${selectable}`}>
                  <Icon.reward />
                  {d.rewards.join(', ')}
                </span>
              )}
              {ownWindow && (
                <span className={`${muted} ${selectable}`}>
                  {t.window(shortDate(d.startsAt), shortDate(d.endsAt))}
                </span>
              )}
            </div>
            <div className={dropProgress}>
              <div
                className={dropBar}
                role="progressbar"
                aria-label={d.name}
                aria-valuemin={0}
                aria-valuemax={d.requiredMinutes}
                aria-valuenow={Math.floor(d.minutes)}
              >
                <i style={{ width: `${percent}%` }} />
              </div>
              <span className={muted}>{t.minutes(Math.floor(d.minutes), d.requiredMinutes)}</span>
            </div>
            <span
              className={`${dropState} ${
                state === 'claimed' || state === 'finished'
                  ? dropDone
                  : state === 'awaitsLink' || state === 'ended'
                    ? dropWarn
                    : ''
              }`}
            >
              {state === 'claimed' && <Icon.check />}
              {state === 'notStarted' && startsIn > 0 ? t.startsIn(startsIn) : t.status[state]}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
