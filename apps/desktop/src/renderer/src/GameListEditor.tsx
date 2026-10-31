// A list of game names edited through a search box: typing filters the games that have current
// campaigns, and any other name can be added as typed. Used for the priority and exclude lists.
import type { CampaignView } from '@tdc/ipc-contract'
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useMiner } from './live'
import { RemoteImage } from './RemoteImage'
import { strings } from './strings'

const t = strings.gameList

interface GameSuggestion {
  name: string
  imageUrl?: string
  /** No campaign running yet, only upcoming ones. */
  upcoming: boolean
}

/** Games with an active or upcoming campaign, A to Z. */
function gameSuggestions(campaigns: readonly CampaignView[]): GameSuggestion[] {
  const games = new Map<string, GameSuggestion>()
  for (const c of campaigns) {
    if (c.state === 'expired') continue
    const known = games.get(c.game)
    games.set(c.game, {
      name: c.game,
      ...((known?.imageUrl ?? c.imageUrl) ? { imageUrl: known?.imageUrl ?? c.imageUrl } : {}),
      upcoming: (known?.upcoming ?? true) && c.state === 'upcoming'
    })
  }
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

type Option = { kind: 'game'; game: GameSuggestion } | { kind: 'typed'; name: string }

export function GameListEditor(props: {
  label: string
  value: readonly string[]
  onChange: (next: string[]) => void
  /** Games on the other list: neither suggested nor addable here (priority vs exclude). */
  taken?: readonly string[]
  /** Order matters (the priority list): show buttons to move entries. */
  ordered?: boolean
}): ReactNode {
  const { label, value, onChange, taken = [], ordered = false } = props
  const suggestions = gameSuggestions(useMiner()?.campaigns ?? [])
  const id = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  /** On this list already, or on the other one. */
  const unavailable = (name: string): boolean =>
    value.some((v) => same(v, name)) || taken.some((v) => same(v, name))
  const query = text.trim()
  const options: Option[] = suggestions
    .filter((g) => !unavailable(g.name))
    .filter((g) => g.name.toLowerCase().includes(query.toLowerCase()))
    .map((game) => ({ kind: 'game', game }))
  if (
    query !== '' &&
    !unavailable(query) &&
    !options.some((o) => o.kind === 'game' && same(o.game.name, query))
  ) {
    options.push({ kind: 'typed', name: query })
  }
  const shown = open && options.length > 0
  const optionId = (i: number): string => `${id}-option-${i}`
  // Keep the highlighted suggestion in view while moving through a long list with the keys.
  useEffect(() => {
    if (active >= 0)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, active])

  const add = (name: string): void => {
    if (name === '' || unavailable(name)) return
    onChange([...value, name])
    setText('')
    // The list stays open for adding more; it sits in the page flow, so it covers nothing.
    setActive(-1)
  }
  const choose = (option: Option): void =>
    add(option.kind === 'game' ? option.game.name : option.name)
  const move = (index: number, by: -1 | 1): void => {
    const next = [...value]
    const [entry] = next.splice(index, 1)
    next.splice(index + by, 0, entry!)
    onChange(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (options.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => (current + step + options.length) % options.length)
    } else if (event.key === 'Enter') {
      // Never submit the settings form from here.
      event.preventDefault()
      const option = shown && active >= 0 ? options[active] : undefined
      if (option) choose(option)
      else add(query)
    } else if (event.key === 'Escape' && shown) {
      event.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="game-list">
      <label htmlFor={id}>{label}</label>
      {value.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <ol aria-label={label}>
          {value.map((name, i) => (
            <li key={name}>
              {name}{' '}
              {ordered && (
                <>
                  <button
                    type="button"
                    aria-label={t.moveUp(name)}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={t.moveDown(name)}
                    disabled={i === value.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={t.remove(name)}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="combobox">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={`${id}-listbox`}
          {...(shown && active >= 0 ? { 'aria-activedescendant': optionId(active) } : {})}
          placeholder={t.placeholder}
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setActive(-1)
          }}
          onKeyDown={onKeyDown}
        />
        {shown && (
          <ul role="listbox" id={`${id}-listbox`} aria-label={t.options(label)}>
            {options.map((option, i) => (
              <li
                key={option.kind === 'game' ? option.game.name : `typed:${option.name}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // Keep focus in the input, so the list doesn't close before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(i)}
              >
                {option.kind === 'game' ? (
                  <>
                    <RemoteImage url={option.game.imageUrl} width={18} height={24} />
                    {option.game.name}
                    {option.game.upcoming && ` ${t.upcoming}`}
                  </>
                ) : (
                  t.addTyped(option.name)
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
