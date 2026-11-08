// Small shared pieces of the new UI: box art, popovers, the list control.
import { imageSrc } from '@tdc/ipc-contract'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { huesOf } from './art'
import { MAX_HEIGHT, placePopover, type Placement } from './placement'
import { icons } from './icons'
import { useOpenExternal, type ListChoice } from './data'
import { strings as t } from './strings'
import ui from './ui.module.css'

const {
  cover,
  coverLetter,
  popWrap,
  pop,
  popStart,
  popEnd,
  popUp,
  segmented,
  chip,
  chipAccent,
  sectionToggle,
  truncated,
  truncatedText,
  selectable: selectableClass,
  channelLink
} = ui

/** A game's box art (portrait), over a placeholder in the game's colours. */
export function Cover(props: {
  game: string
  url?: string | undefined
  size: string | undefined
}): ReactNode {
  const { game, url, size } = props
  const [failed, setFailed] = useState(false)
  return (
    <div className={`${cover} ${size ?? ''}`} style={huesOf(game)} aria-hidden="true">
      <span className={coverLetter}>{game.slice(0, 1)}</span>
      {url && !failed && (
        <img src={imageSrc(url)} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
    </div>
  )
}

/**
 * A button that opens a panel below it (or above, with `up`), moved and sized to stay inside
 * the window. Closes on Escape, on a click outside, on resize, or when the panel calls `close`.
 */
export function Popover(props: {
  label: string
  buttonClass: string | undefined
  button: ReactNode
  align?: 'start' | 'end'
  up?: boolean
  width?: number
  tip?: string
  /** A key that opens it from anywhere (aria-keyshortcuts spelling, as "F1"). */
  shortcut?: string
  children: (close: () => void) => ReactNode
}): ReactNode {
  const {
    label,
    buttonClass,
    button,
    align = 'start',
    up = false,
    width,
    tip,
    shortcut,
    children
  } = props
  const [open, setOpen] = useState(false)
  // Opened from the keyboard: the first item gets focus, so arrows work straight away.
  const [byKeyboard, setByKeyboard] = useState(false)
  const [placement, setPlacement] = useState<Placement>({ up, align })
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()

  // Measured before the panel is painted, so it never shows in the wrong place.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return
    const box = panel.current.getBoundingClientRect()
    setPlacement(
      placePopover({
        button: trigger.current.getBoundingClientRect(),
        panel: { width: box.width, height: Math.min(panel.current.scrollHeight, MAX_HEIGHT) },
        window: { width: window.innerWidth, height: window.innerHeight },
        prefer: { up, align }
      })
    )
    if (byKeyboard) {
      panel.current
        .querySelector<HTMLElement>('button:not(:disabled), a[href], input, select')
        ?.focus()
    }
  }, [open, up, align, byKeyboard])

  /** Closes it; focus goes back to the button when it was inside the panel. */
  const close = (): void => {
    // By id, not ref: the panel's children call this, and render code mustn't read refs.
    if (document.getElementById(id)?.contains(document.activeElement)) {
      document.getElementById(`${id}-button`)?.focus()
    }
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <div className={popWrap} ref={wrap}>
      <button
        ref={trigger}
        id={`${id}-button`}
        type="button"
        className={buttonClass}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-tip={open ? undefined : tip}
        aria-keyshortcuts={shortcut}
        onClick={(event) => {
          setPlacement({ up, align })
          // detail is 0 for Enter, Space and clicks from code (a shortcut).
          setByKeyboard(event.detail === 0)
          setOpen((was) => !was)
        }}
      >
        {button}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          ref={panel}
          data-keys="menu"
          className={`${pop} ${placement.align === 'end' ? popEnd : popStart} ${placement.up ? popUp : ''}`}
          style={{
            ...(width ? { minWidth: width } : {}),
            ...(placement.maxHeight !== undefined ? { maxHeight: placement.maxHeight } : {})
          }}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}

const CHOICES: readonly ListChoice[] = ['priority', 'notSet', 'excluded']

/** Priority / Not set / Excluded for one game. */
export function ListControl(props: {
  game: string
  value: ListChoice
  onChange: (choice: ListChoice) => void
}): ReactNode {
  const { game, value, onChange } = props
  return (
    <div className={segmented} role="group" aria-label={t.list.groupLabel(game)} data-keys="row">
      {CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={value === choice}
          onClick={() => value !== choice && onChange(choice)}
        >
          {t.list[choice]}
        </button>
      ))}
    </div>
  )
}

export function ListChip(props: { value: ListChoice }): ReactNode {
  if (props.value === 'priority')
    return <span className={`${chip} ${chipAccent}`}>{t.list.priority}</span>
  return <span className={chip}>{t.list[props.value]}</span>
}

/** A section's heading that collapses it; the section keeps its count and header. */
export function SectionTitle(props: {
  label: string
  collapsed: boolean
  controls: string
  onToggle: () => void
}): ReactNode {
  const { label, collapsed, controls, onToggle } = props
  const Chevron = icons.down
  return (
    <h2>
      <button
        type="button"
        className={sectionToggle}
        aria-expanded={!collapsed}
        aria-controls={controls}
        onClick={onToggle}
      >
        <Chevron />
        {label}
      </button>
    </h2>
  )
}

/**
 * Text that ends in "…" when it doesn't fit; hovering it then shows the whole text in a
 * tooltip. Screen readers get the whole text either way.
 */
export function Truncated(props: {
  text: string
  className?: string | undefined
  /** Worth copying (a campaign or drop name): it can be selected. */
  selectable?: boolean
}): ReactNode {
  const { text, className, selectable = false } = props
  const [tip, setTip] = useState<string>()
  return (
    <span
      className={`${truncated} ${className ?? ''} ${selectable ? selectableClass : ''}`}
      data-tip={tip}
      onMouseEnter={(event) => {
        const inner = event.currentTarget.firstElementChild
        const cut = inner instanceof HTMLElement && inner.scrollWidth > inner.clientWidth
        setTip(cut ? text : undefined)
      }}
    >
      <span className={truncatedText}>{text}</span>
    </span>
  )
}

/** A channel's address on Twitch. */
const channelUrl = (login: string): string =>
  `https://www.twitch.tv/${encodeURIComponent(login.toLowerCase())}`

/** A channel's name that opens the channel on Twitch, in the browser, to watch it there. */
export function ChannelLink(props: { login: string; name?: string | undefined }): ReactNode {
  const { login, name } = props
  const openExternal = useOpenExternal()
  const url = channelUrl(login)
  return (
    <a
      className={channelLink}
      href={url}
      data-tip={t.watchOnTwitch}
      onClick={(event) => {
        // The window never navigates; main opens it in the browser.
        event.preventDefault()
        openExternal(url)
      }}
    >
      {name ?? login}
    </a>
  )
}
