// Temporary inventory screen: every known campaign and its drops.
import { useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { invoke } from './ipc'
import { useMiner } from './live'
import { DropProgress } from './MiningPanel'
import { RemoteImage } from './RemoteImage'
import { strings } from './strings'

const t = strings.inventory
const date = (iso: string): string => new Date(iso).toLocaleString()

export function InventoryScreen(): ReactNode {
  const miner = useMiner()
  const openLink = useMutation({
    mutationFn: (url: string) => invoke('shell:openExternal', { url })
  })
  if (!miner) return <p>{strings.main.loading}</p>
  if (miner.campaigns.length === 0) return <p>{t.empty}</p>

  return (
    <section aria-labelledby="inventory-heading">
      <h2 id="inventory-heading">{t.heading(miner.campaigns.length)}</h2>
      {miner.campaigns.map((c) => (
        <article key={c.id} data-testid="campaign" aria-label={`${c.game}: ${c.name}`}>
          <h3>
            <RemoteImage url={c.imageUrl} width={45} height={60} />
            {c.game}: {c.name}
          </h3>
          <p>
            {t.state[c.state]} · {date(c.startsAt)} to {date(c.endsAt)}
            {c.allowListed && ` · ${t.allowListed}`} ·{' '}
            {c.linked ? (
              t.linked
            ) : (
              <>
                {t.notLinked}
                {c.linkUrl?.startsWith('https://') && (
                  <>
                    {' '}
                    <button type="button" onClick={() => openLink.mutate(c.linkUrl!)}>
                      {t.link}
                    </button>
                  </>
                )}
              </>
            )}
          </p>
          <ul>
            {c.drops.map((d) => (
              <li key={d.id}>
                <RemoteImage url={d.imageUrl} width={32} height={32} />
                {d.name}: {d.rewards.join(', ')} <DropProgress drop={d} />
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  )
}
