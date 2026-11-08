// Current: what's being mined, with its drops, the channel and Pause / Continue.
import { useMutation } from '@tanstack/react-query'
import { imageSrc, type CampaignView, type DropView, type MinerView } from '@tdc/ipc-contract'
import { useState, type ReactNode } from 'react'
import { invoke } from '../../ipc'
import { huesOf } from '../art'
import { useSettingsPatch } from '../data'
import { duration, minutesUntil } from '../format'
import { icons } from '../icons'
import { ChannelLink, Cover, Popover } from '../parts'
import { channelsFor } from './channels'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Drops.module.css'

const t = strings.current
const {
  current,
  paused: pausedClass,
  banner,
  art,
  artClip,
  shade,
  bannerText,
  kicker,
  live,
  title,
  subtitle,
  watching,
  bannerActions,
  floatingCover,
  currentBody,
  idle,
  drops,
  join,
  joinLit,
  reward,
  done,
  tick,
  future,
  now: nowClass,
  names,
  rewardName,
  progress,
  bar,
  left
} = styles
const {
  btn,
  btnLarge,
  glass,
  green,
  coverLg,
  menuItem,
  menuItemEnd,
  check,
  popHeading,
  note,
  separator,
  muted,
  grow,
  selectable
} = ui
const Icon = icons

type DropState = 'done' | 'now' | 'future'

function stateOf(d: DropView, currentId: string | undefined): DropState {
  if (d.claimed || d.awaitsConnection) return 'done'
  return d.id === currentId ? 'now' : 'future'
}

function DropNames(props: { drop: DropView; state: DropState }): ReactNode {
  const { drop, state } = props
  const tail =
    state === 'done'
      ? drop.awaitsConnection
        ? t.awaitsLink
        : t.claimed
      : state === 'now'
        ? t.minutes(Math.floor(drop.minutes), drop.requiredMinutes)
        : t.unlocksAt(drop.requiredMinutes, drop.requiredMinutes - drop.minutes)
  return (
    <>
      <b className={selectable}>{drop.name}</b>
      {drop.rewards.length > 0 && (
        <span className={`${rewardName} ${selectable}`}>
          <Icon.reward />
          {drop.rewards.join(', ')}
        </span>
      )}
      <span className={muted}>{tail}</span>
    </>
  )
}

function ChannelPicker(props: { miner: MinerView; campaign: CampaignView }): ReactNode {
  const { miner, campaign } = props
  const select = useMutation({
    mutationFn: (channelId: string | undefined) =>
      invoke('miner:selectChannel', channelId ? { channelId } : {})
  })
  const relevant = channelsFor(campaign, miner.channels, miner.watching?.id)
  return (
    <Popover
      label={t.changeLabel}
      buttonClass={`${btn} ${glass}`}
      button={
        <>
          <Icon.change />
          {t.change}
        </>
      }
      width={330}
    >
      {(close) => (
        <>
          <div className={popHeading}>{t.channelsFor(campaign.name)}</div>
          {relevant.length === 0 && <div className={note}>{t.noChannels}</div>}
          {relevant.map((c) =>
            c.unwatchable ? (
              <button key={c.id} type="button" className={menuItem} disabled>
                <Icon.channel />
                {c.displayName ?? c.login}
                <span className={menuItemEnd}>{t.unwatchable[c.unwatchable]}</span>
              </button>
            ) : (
              <button
                key={c.id}
                type="button"
                className={menuItem}
                onClick={() => {
                  select.mutate(c.id)
                  close()
                }}
              >
                <span className={check}>{miner.watching?.id === c.id && <Icon.check />}</span>
                {c.displayName ?? c.login}
                <span className={menuItemEnd}>
                  <Icon.viewers />
                  {(c.viewers ?? 0).toLocaleString()}
                </span>
              </button>
            )
          )}
          {miner.selected && (
            <>
              <hr className={separator} />
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  select.mutate(undefined)
                  close()
                }}
              >
                <Icon.undo />
                {t.letMinerChoose}
              </button>
            </>
          )}
          <div className={note}>{t.channelsNote}</div>
        </>
      )}
    </Popover>
  )
}

function PauseButton(props: { paused: boolean }): ReactNode {
  const { save, saving } = useSettingsPatch()
  return props.paused ? (
    <button
      type="button"
      className={`${btn} ${btnLarge} ${green}`}
      disabled={saving}
      onClick={() => save({ queue: { paused: false } })}
    >
      <Icon.play />
      {t.resume}
    </button>
  ) : (
    <button
      type="button"
      className={`${btn} ${btnLarge} ${glass}`}
      disabled={saving}
      onClick={() => save({ queue: { paused: true } })}
    >
      <Icon.pause />
      {t.pause}
    </button>
  )
}

/** Mining paused, idle or loading: no campaign to show. */
function NotMining(props: { miner: MinerView | undefined }): ReactNode {
  const { miner } = props
  const paused = miner?.userPaused === true
  const heading = paused
    ? t.pausedHeading
    : miner?.status === 'loading' || !miner
      ? t.loadingHeading
      : t.idleHeading
  const lead = paused ? t.pausedLead : (miner?.message ?? t.idleFallback)
  return (
    <section className={`${current} ${paused ? pausedClass : ''}`} aria-label={t.label}>
      <div className={idle}>
        <div className={grow}>
          <h2>{heading}</h2>
          <p className={muted} role="status">
            {lead}
          </p>
        </div>
        {miner && miner.status !== 'stopped' && (paused || miner.status !== 'paused') && (
          <span className={bannerActions}>
            <PauseButton paused={paused} />
          </span>
        )}
      </div>
    </section>
  )
}

export function Current(props: { miner: MinerView | undefined; now: number }): ReactNode {
  const { miner, now } = props
  const [hovered, setHovered] = useState<string | undefined>()
  const campaign = miner?.campaigns.find((c) => c.id === miner.active?.campaignId)
  if (!miner || !campaign || miner.userPaused) return <NotMining miner={miner} />

  const currentId = miner.active?.drop?.id
  const ordered = [...campaign.drops].sort((a, b) => a.requiredMinutes - b.requiredMinutes)
  const currentDrop = ordered.find((d) => d.id === currentId)
  const shown = ordered.find((d) => d.id === hovered) ?? currentDrop
  const percent = currentDrop
    ? Math.min(100, (currentDrop.minutes / currentDrop.requiredMinutes) * 100)
    : 0
  const artUrl = campaign.boxArtUrl ?? campaign.imageUrl
  const channel = miner.watching

  return (
    <section className={current} aria-label={t.label}>
      <div className={banner} style={huesOf(campaign.game)}>
        <div className={artClip}>
          <div className={art}>{artUrl && <img src={imageSrc(artUrl)} alt="" />}</div>
          <div className={shade} />
        </div>
        <div className={bannerText}>
          <div className={kicker}>
            <span className={live} />
            {t.miningNow}
          </div>
          <h2 className={title}>{campaign.game}</h2>
          <div className={subtitle}>
            <span className={selectable}>{campaign.name}</span>
            {t.endsSuffix(minutesUntil(campaign.endsAt, now))}
          </div>
          {channel && (
            <div className={watching}>
              <span>
                {t.watching}{' '}
                <b>
                  <ChannelLink login={channel.login} name={channel.displayName} />
                </b>
                {channel.viewers !== undefined && <> · {t.viewers(channel.viewers)}</>}
              </span>
              <ChannelPicker miner={miner} campaign={campaign} />
            </div>
          )}
        </div>
        <div className={bannerActions}>
          <PauseButton paused={false} />
        </div>
      </div>
      <div className={floatingCover}>
        <Cover game={campaign.game} url={campaign.boxArtUrl} size={coverLg} />
      </div>
      <div className={currentBody}>
        <div className={drops} onMouseLeave={() => setHovered(undefined)}>
          {ordered.map((d, i) => {
            const state = stateOf(d, currentId)
            return (
              <span key={d.id} style={{ display: 'contents' }}>
                {i > 0 && <span className={`${join} ${state !== 'future' ? joinLit : ''}`} />}
                <span
                  className={`${reward} ${state === 'done' ? done : state === 'now' ? nowClass : future}`}
                  style={huesOf(d.name)}
                  role="img"
                  tabIndex={0}
                  aria-label={d.name}
                  onMouseEnter={() => setHovered(d.id)}
                  onFocus={() => setHovered(d.id)}
                  onBlur={() => setHovered(undefined)}
                >
                  {d.imageUrl ? <img src={imageSrc(d.imageUrl)} alt="" /> : <Icon.reward />}
                  {state === 'done' && (
                    <span className={tick}>
                      <Icon.check />
                    </span>
                  )}
                </span>
              </span>
            )
          })}
        </div>
        <div className={names} aria-live="polite">
          {shown && <DropNames drop={shown} state={stateOf(shown, currentId)} />}
        </div>
        {currentDrop && (
          <div className={progress}>
            <div
              className={bar}
              role="progressbar"
              aria-label={currentDrop.name}
              aria-valuemin={0}
              aria-valuemax={currentDrop.requiredMinutes}
              aria-valuenow={Math.floor(currentDrop.minutes)}
            >
              <i style={{ width: `${percent}%` }} />
            </div>
            <span className={left}>
              <b>{duration(currentDrop.requiredMinutes - currentDrop.minutes)}</b> {t.remaining}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
