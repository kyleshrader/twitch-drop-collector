// The settings that don't live on a page of their own. Up next's options are in its sort menu,
// and the game lists are in the Library.
import { useMutation } from '@tanstack/react-query'
import type { SettingsView } from '@tdc/ipc-contract'
import { useState, type ReactNode } from 'react'
import { invoke } from '../../ipc'
import { useApiIssues } from '../../live'
import { useSettingsPatch } from '../data'
import { icons } from '../icons'
import { routeHref } from '../router'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Pages.module.css'
import { validProxy } from './settings'

const t = strings.settings
const Icon = icons
const { page, panel, settingRow, settingNote, toggle, field, fieldError } = styles
const { segmented, btn, grow } = ui

function Row(props: { name: string; note?: string; children: ReactNode }): ReactNode {
  return (
    <div className={settingRow}>
      <div className={grow}>
        <div>{props.name}</div>
        {props.note && <div className={settingNote}>{props.note}</div>}
      </div>
      {props.children}
    </div>
  )
}

function Toggle(props: { label: string; on: boolean; onChange: (on: boolean) => void }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      className={toggle}
      aria-checked={props.on}
      aria-label={props.label}
      onClick={() => props.onChange(!props.on)}
    />
  )
}

/** The proxy address: saved when it's valid and you leave the field or press Enter. */
function ProxyField(props: { value: string; onSave: (value: string) => void }): ReactNode {
  const [draft, setDraft] = useState(props.value)
  const trimmed = draft.trim()
  const valid = validProxy(trimmed)
  const commit = (): void => {
    if (valid && trimmed !== props.value) props.onSave(trimmed)
  }
  return (
    <div>
      <input
        className={field}
        type="text"
        spellCheck={false}
        placeholder={t.proxyPlaceholder}
        aria-label={t.proxy}
        aria-invalid={!valid}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
      {!valid && <div className={fieldError}>{t.proxyInvalid}</div>}
    </div>
  )
}

const LEVELS = ['error', 'warn', 'info', 'debug'] as const
const QUALITY = [1, 2, 3, 4, 5, 6] as const

export function SettingsPage(props: { settings: SettingsView }): ReactNode {
  const { settings } = props
  const { save, failed } = useSettingsPatch()
  const openLogs = useMutation({ mutationFn: () => invoke('app:openLogsFolder') })
  const apiIssues = useApiIssues()
  const toggleRow = (
    name: string,
    note: string,
    on: boolean,
    onChange: (on: boolean) => void
  ): ReactNode => (
    <Row name={name} note={note}>
      <Toggle label={name} on={on} onChange={onChange} />
    </Row>
  )
  const general = (key: 'closeToTray' | 'launchAtLogin' | 'startMinimized' | 'trayNotifications') =>
    toggleRow(t.toggles[key].name, t.toggles[key].note, settings.general[key], (on) =>
      save({ general: { [key]: on } })
    )

  return (
    <div className={page}>
      <h2>{t.heading}</h2>
      {failed && <p role="alert">{strings.saveFailed}</p>}

      <div className={panel}>
        <Row name={t.theme}>
          <div className={segmented} role="group" aria-label={t.theme} data-keys="row">
            {(['system', 'dark', 'light'] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                aria-pressed={settings.general.theme === theme}
                onClick={() => save({ general: { theme } })}
              >
                {t.themes[theme]}
              </button>
            ))}
          </div>
        </Row>
        {general('closeToTray')}
        {general('launchAtLogin')}
        {general('startMinimized')}
        {general('trayNotifications')}
      </div>

      <h3>{t.mining}</h3>
      <div className={panel}>
        {toggleRow(
          t.toggles.mineNotSet.name,
          t.toggles.mineNotSet.note,
          settings.mining.priorityMode !== 'priorityOnly',
          (on) => save({ mining: { priorityMode: on ? 'endingSoonest' : 'priorityOnly' } })
        )}
        {toggleRow(
          t.toggles.enableBadgesEmotes.name,
          t.toggles.enableBadgesEmotes.note,
          settings.mining.enableBadgesEmotes,
          (on) => save({ mining: { enableBadgesEmotes: on } })
        )}
        {toggleRow(
          t.toggles.availableDropsCheck.name,
          t.toggles.availableDropsCheck.note,
          settings.mining.availableDropsCheck,
          (on) => save({ mining: { availableDropsCheck: on } })
        )}
      </div>

      <h3>{t.updates}</h3>
      <div className={panel}>
        {toggleRow(
          t.toggles.autoUpdate.name,
          t.toggles.autoUpdate.note,
          settings.updates.mode === 'auto',
          (on) => save({ updates: { mode: on ? 'auto' : 'notify' } })
        )}
        {toggleRow(
          t.toggles.prereleases.name,
          t.toggles.prereleases.note,
          settings.updates.prereleases,
          (on) => save({ updates: { prereleases: on } })
        )}
        <Row name={t.appUpdates}>
          <a className={btn} href={routeHref({ page: 'updates' })}>
            {t.checkNow}
          </a>
        </Row>
      </div>

      <h3>{t.network}</h3>
      <div className={panel}>
        <Row name={t.proxy} note={t.proxyNote}>
          <ProxyField
            key={settings.network.proxy}
            value={settings.network.proxy}
            onSave={(proxy) => save({ network: { proxy } })}
          />
        </Row>
        <Row name={t.connection} note={t.connectionNote}>
          <select
            className={field}
            aria-label={t.connection}
            value={settings.network.connectionQuality}
            onChange={(event) =>
              save({ network: { connectionQuality: Number(event.target.value) } })
            }
          >
            {QUALITY.map((q) => (
              <option key={q} value={q}>
                {t.connectionLevels(q)}
              </option>
            ))}
          </select>
        </Row>
      </div>

      <h3>{t.diagnostics}</h3>
      <div className={panel}>
        <Row name={t.logLevel}>
          <select
            className={field}
            aria-label={t.logLevel}
            value={settings.logging.level}
            onChange={(event) =>
              save({ logging: { level: event.target.value as (typeof LEVELS)[number] } })
            }
          >
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {t.logLevels[level]}
              </option>
            ))}
          </select>
        </Row>
        {toggleRow(
          t.toggles.crashReports.name,
          t.toggles.crashReports.note,
          settings.general.crashReports,
          (on) => save({ general: { crashReports: on } })
        )}
        <Row name={t.logs}>
          <button type="button" className={btn} onClick={() => openLogs.mutate()}>
            <Icon.folder />
            {t.openLogs}
          </button>
        </Row>
        <Row
          name={strings.twitchApi.settingsRow}
          note={strings.twitchApi.settingsNote(
            strings.twitchApi.counts(apiIssues?.errors ?? 0, apiIssues?.warnings ?? 0)
          )}
        >
          <a className={btn} href={routeHref({ page: 'twitchApi' })}>
            <Icon.twitchApi />
            {strings.twitchApi.open}
          </a>
        </Row>
      </div>
    </div>
  )
}
