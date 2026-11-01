// Temporary inventory screen: every known campaign and its drops, with shop-style filters.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CampaignView } from '@tdc/ipc-contract'
import { useState, type ReactNode } from 'react'
import {
  applyFilters,
  clearFacet,
  facetOptions,
  FACETS,
  isFiltered,
  listOf,
  NO_FILTERS,
  toggle,
  type Facet,
  type GameLists,
  type InventoryFilters
} from './inventory-filters'
import { invoke } from './ipc'
import { SETTINGS_KEY, useMiner, useSettings } from './live'
import { DropProgress } from './MiningPanel'
import { RemoteImage } from './RemoteImage'
import { strings } from './strings'

const t = strings.inventory
const f = t.filters
const date = (iso: string): string => new Date(iso).toLocaleString()

/** Games shown before "Show all". */
const GAMES_SHOWN = 8

/** The filters outlive the screen, so switching tabs keeps them; a restart starts afresh. */
let remembered: InventoryFilters = NO_FILTERS

/** Where a campaign's game stands on the priority and excluded lists, for its card. */
function ListPlacement({ game, lists }: { game: string; lists: GameLists }): ReactNode {
  const place = listOf(game, lists)
  if (place === 'neither') return null
  return (
    <> · {place === 'excluded' ? t.excluded : t.priorityRank(lists.priority.indexOf(game) + 1)}</>
  )
}

const optionLabel = (facet: Facet, key: string): string =>
  facet === 'game' ? key : ((f.options[facet] as Record<string, string>)[key] ?? key)

/**
 * Add the campaign's game to the priority or excluded list, or take it off the one it's on.
 * Saves straight to settings; additions go to the end of the list.
 */
function ListActions({ game, lists }: { game: string; lists: GameLists }): ReactNode {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (mining: { priority: string[] } | { exclude: string[] }) =>
      invoke('settings:update', { mining }),
    onSuccess: (saved) => queryClient.setQueryData(SETTINGS_KEY, saved)
  })
  const place = listOf(game, lists)
  const button = (label: string, name: string, mining: Parameters<typeof save.mutate>[0]) => (
    <button
      type="button"
      aria-label={name}
      disabled={save.isPending}
      onClick={() => save.mutate(mining)}
    >
      {label}
    </button>
  )
  return (
    <p className="list-actions">
      {place === 'neither' && (
        <>
          {button(t.lists.addPriority, t.lists.addPriorityFor(game), {
            priority: [...lists.priority, game]
          })}{' '}
          {button(t.lists.addExcluded, t.lists.addExcludedFor(game), {
            exclude: [...lists.exclude, game]
          })}
        </>
      )}
      {place === 'priority' &&
        button(t.lists.removePriority, t.lists.removePriorityFor(game), {
          priority: lists.priority.filter((g) => g !== game)
        })}
      {place === 'excluded' &&
        button(t.lists.removeExcluded, t.lists.removeExcludedFor(game), {
          exclude: lists.exclude.filter((g) => g !== game)
        })}
      {save.isError && <span role="alert"> {t.lists.saveFailed}</span>}
    </p>
  )
}

function FacetGroup(props: {
  facet: Facet
  campaigns: readonly CampaignView[]
  filters: InventoryFilters
  lists: GameLists
  onChange: (next: InventoryFilters) => void
}): ReactNode {
  const { facet, campaigns, filters, lists, onChange } = props
  const [expanded, setExpanded] = useState(false)
  const options = facetOptions(facet, campaigns, filters, lists)
  const collapsible = facet === 'game' && options.length > GAMES_SHOWN
  // Ticked games always stay visible, even beyond the first few.
  const visible =
    collapsible && !expanded ? options.filter((o, i) => i < GAMES_SHOWN || o.selected) : options
  const ticked = filters.selected[facet].length > 0
  return (
    <fieldset>
      <legend>{f.facets[facet]}</legend>
      {visible.map((o) => (
        <label key={o.key} className={o.count === 0 && !o.selected ? 'empty' : undefined}>
          <input
            type="checkbox"
            checked={o.selected}
            disabled={o.count === 0 && !o.selected}
            onChange={() => onChange(toggle(filters, facet, o.key))}
          />
          {optionLabel(facet, o.key)} <span className="count">({o.count})</span>
        </label>
      ))}
      {collapsible && (
        <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? f.showFewer : f.showAll(options.length)}
        </button>
      )}
      {ticked && (
        <button
          type="button"
          className="link"
          aria-label={f.clearFacet(f.facets[facet])}
          onClick={() => onChange(clearFacet(filters, facet))}
        >
          {f.clear}
        </button>
      )}
    </fieldset>
  )
}

export function InventoryScreen(): ReactNode {
  const miner = useMiner()
  const settings = useSettings()
  const openLink = useMutation({
    mutationFn: (url: string) => invoke('shell:openExternal', { url })
  })
  const [filters, setFilters] = useState(remembered)
  const change = (next: InventoryFilters): void => {
    remembered = next
    setFilters(next)
  }
  if (!miner) return <p>{strings.main.loading}</p>
  if (miner.campaigns.length === 0) return <p>{t.empty}</p>
  const lists: GameLists = {
    priority: settings?.mining.priority ?? [],
    exclude: settings?.mining.exclude ?? []
  }
  const shown = applyFilters(miner.campaigns, filters, lists)

  return (
    <section aria-labelledby="inventory-heading">
      <h2 id="inventory-heading">{t.heading(miner.campaigns.length)}</h2>
      <div className="inventory">
        <aside role="search" aria-label={f.label} className="inventory-filters">
          <label>
            {f.search}
            <input
              type="search"
              value={filters.search}
              placeholder={f.searchPlaceholder}
              onChange={(e) => change({ ...filters, search: e.target.value })}
            />
          </label>
          {FACETS.map((facet) => (
            <FacetGroup
              key={facet}
              facet={facet}
              campaigns={miner.campaigns}
              filters={filters}
              lists={lists}
              onChange={change}
            />
          ))}
        </aside>
        <div className="inventory-results">
          <p role="status">
            {f.showing(shown.length, miner.campaigns.length)}
            {isFiltered(filters) && (
              <>
                {' '}
                <button type="button" onClick={() => change(NO_FILTERS)}>
                  {f.clearAll}
                </button>
              </>
            )}
          </p>
          {shown.length === 0 && <p>{f.none}</p>}
          {shown.map((c) => (
            <article key={c.id} data-testid="campaign" aria-label={`${c.game}: ${c.name}`}>
              <h3>
                <RemoteImage url={c.imageUrl} width={45} height={60} />
                {c.game}: {c.name}
              </h3>
              <p>
                {t.state[c.state]} · {date(c.startsAt)} to {date(c.endsAt)}
                {c.allowListed && ` · ${t.allowListed}`}
                <ListPlacement game={c.game} lists={lists} /> ·{' '}
                {c.linked ? (
                  t.linked
                ) : c.badgesEmotes ? (
                  t.noAccountNeeded
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
              <ListActions game={c.game} lists={lists} />
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
        </div>
      </div>
    </section>
  )
}
