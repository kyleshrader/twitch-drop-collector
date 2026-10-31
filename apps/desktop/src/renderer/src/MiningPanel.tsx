// Temporary mining panel: status, what's being watched, the current drop and the channels.
import { useMutation } from '@tanstack/react-query'
import type { ChannelView, DropView } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { invoke } from './ipc'
import { useMiner } from './live'
import { RemoteImage } from './RemoteImage'
import { strings } from './strings'

const t = strings.mining

export function DropProgress({ drop }: { drop: DropView }): ReactNode {
  return (
    <span>
      <progress max={drop.requiredMinutes} value={drop.minutes} />{' '}
      {drop.claimed
        ? t.claimed
        : drop.awaitsConnection
          ? t.awaitsConnection
          : t.minutes(drop.minutes, drop.requiredMinutes)}
    </span>
  )
}

const channelName = (c: ChannelView): string => c.displayName ?? c.login

export function MiningPanel(): ReactNode {
  const miner = useMiner()
  const reload = useMutation({ mutationFn: () => invoke('miner:reload') })
  const select = useMutation({
    mutationFn: (channelId: string | undefined) =>
      invoke('miner:selectChannel', channelId === undefined ? {} : { channelId })
  })
  if (!miner) return <p>{strings.main.loading}</p>

  return (
    <section aria-labelledby="mining-heading">
      <h2 id="mining-heading">{t.heading}</h2>
      <p role="status" data-testid="miner-status">
        {t.status[miner.status]}
        {miner.message && `: ${miner.message}`}
      </p>
      {miner.watching && (
        <p data-testid="miner-watching">
          {t.watching(channelName(miner.watching), miner.watching.game, miner.watching.viewers)}
        </p>
      )}
      {miner.active && (
        <p data-testid="miner-active">
          {miner.active.game}: {miner.active.campaign}
          {miner.active.drop && (
            <>
              <br />
              <RemoteImage url={miner.active.drop.imageUrl} width={32} height={32} />
              {miner.active.drop.name} ({miner.active.drop.rewards.join(', ')}){' '}
              <DropProgress drop={miner.active.drop} />
            </>
          )}
        </p>
      )}
      {miner.wanted.length > 0 && <p>{t.wanted(miner.wanted)}</p>}
      <p>
        <button type="button" onClick={() => reload.mutate()}>
          {t.reload}
        </button>{' '}
        <button type="button" onClick={() => select.mutate(undefined)}>
          {t.letMinerChoose}
        </button>
      </p>

      <h3>{t.channels(miner.channels.length)}</h3>
      {miner.channels.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t.columns.channel}</th>
              <th>{t.columns.status}</th>
              <th>{t.columns.game}</th>
              <th>{t.columns.viewers}</th>
              <th>{t.columns.drops}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {miner.channels.map((c) => (
              <tr key={c.id} aria-current={miner.watching?.id === c.id ? 'true' : undefined}>
                <td>
                  {channelName(c)}
                  {c.aclBased && ` ${t.allowListed}`}
                  {miner.selected === c.id && ` ${t.yourPick}`}
                </td>
                <td>{c.online ? t.online : t.offline}</td>
                <td>{c.game ?? ''}</td>
                <td>{c.viewers ?? ''}</td>
                <td>{c.dropsEnabled === undefined ? '' : c.dropsEnabled ? t.yes : t.no}</td>
                <td>
                  {/* Only offer picks the miner would follow; say why not otherwise. */}
                  {miner.watching?.id === c.id ? (
                    t.watchingNow
                  ) : c.unwatchable ? (
                    t.unwatchable[c.unwatchable]
                  ) : (
                    <button type="button" onClick={() => select.mutate(c.id)}>
                      {t.watchThis}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
