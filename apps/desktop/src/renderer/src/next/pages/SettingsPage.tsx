// The settings that don't live on a page yet. Up next's own options are in its sort menu.
import { useMutation } from '@tanstack/react-query'
import type { SettingsView } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { invoke } from '../../ipc'
import { useApiIssues } from '../../live'
import { useUiChoice } from '../../ui-choice'
import { useSettingsPatch } from '../data'
import { icons } from '../icons'
import { routeHref } from '../router'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Pages.module.css'

const t = strings.settings
const Icon = icons
const { page, lead, panel, settingRow, settingNote, toggle } = styles
const { segmented, btn, grow } = ui

function Row(props: { name: string; note: string; children: ReactNode }): ReactNode {
  return (
    <div className={settingRow}>
      <div className={grow}>
        <div>{props.name}</div>
        <div className={settingNote}>{props.note}</div>
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

export function SettingsPage(props: { settings: SettingsView }): ReactNode {
  const { settings } = props
  const { save, failed } = useSettingsPatch()
  const { switchTo, switching } = useUiChoice()
  const openLogs = useMutation({ mutationFn: () => invoke('app:openLogsFolder') })
  const apiIssues = useApiIssues()
  const general = (
    key: 'closeToTray' | 'launchAtLogin' | 'startMinimized' | 'trayNotifications'
  ): ReactNode => {
    const { name, note } = t.toggles[key]
    return (
      <Row name={name} note={note}>
        <Toggle
          label={name}
          on={settings.general[key]}
          onChange={(on) => save({ general: { [key]: on } })}
        />
      </Row>
    )
  }
  const { name: badgesName, note: badgesNote } = t.toggles.enableBadgesEmotes
  const { name: notSetName, note: notSetNote } = t.toggles.mineNotSet

  return (
    <div className={page}>
      <h2>{t.heading}</h2>
      <p className={lead}>{t.lead}</p>
      {failed && <p role="alert">{strings.saveFailed}</p>}

      <div className={panel}>
        <Row name={t.theme} note={t.themeNote}>
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
        <Row name={notSetName} note={notSetNote}>
          <Toggle
            label={notSetName}
            on={settings.mining.priorityMode !== 'priorityOnly'}
            onChange={(on) =>
              save({ mining: { priorityMode: on ? 'endingSoonest' : 'priorityOnly' } })
            }
          />
        </Row>
        <Row name={badgesName} note={badgesNote}>
          <Toggle
            label={badgesName}
            on={settings.mining.enableBadgesEmotes}
            onChange={(on) => save({ mining: { enableBadgesEmotes: on } })}
          />
        </Row>
      </div>

      <h3>{t.interface}</h3>
      <div className={panel}>
        <Row name={strings.backToClassic} note={t.interfaceNote}>
          <button
            type="button"
            className={btn}
            disabled={switching}
            onClick={() => switchTo('classic')}
          >
            {switching ? strings.switching : strings.backToClassic}
          </button>
        </Row>
        <Row name={t.logs} note="">
          <button type="button" className={btn} onClick={() => openLogs.mutate()}>
            {t.logs}
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
