// The settings that don't live on a page yet, and the queue rules (docs/new-ui/queue-rules.md).
import { useMutation } from '@tanstack/react-query'
import {
  RECOMMENDED_QUEUE_RULES,
  type SettingsPatchInput,
  type SettingsView
} from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { invoke } from '../../ipc'
import { useUiChoice } from '../../ui-choice'
import { useSettingsPatch } from '../data'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Pages.module.css'

const t = strings.settings
const { page, lead, panel, settingRow, settingNote, toggle, select, headingRow } = styles
const { segmented, btn, btnSmall, ghost, grow } = ui

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

type Rule = 'split' | 'dropProgress' | 'campaignProgress' | 'newInCustom'
/** Rules about what Twitch does: they have a recommended value, from Twitch's own docs. */
type TwitchRule = keyof typeof RECOMMENDED_QUEUE_RULES
const TWITCH_RULES: readonly TwitchRule[] = ['dropProgress', 'campaignProgress', 'split']

const recommendedOf = (rule: Rule): string | undefined =>
  rule === 'newInCustom' ? undefined : RECOMMENDED_QUEUE_RULES[rule]

export function SettingsPage(props: { settings: SettingsView }): ReactNode {
  const { settings } = props
  const { save, failed } = useSettingsPatch()
  const { switchTo, switching } = useUiChoice()
  const openLogs = useMutation({ mutationFn: () => invoke('app:openLogsFolder') })
  const onRecommended = TWITCH_RULES.every(
    (rule) => settings.queue[rule] === RECOMMENDED_QUEUE_RULES[rule]
  )
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
  const { name: linkedName, note: linkedNote } = t.ruleNames.linkedFirst

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

      <div className={headingRow}>
        <h3>{t.rules}</h3>
        <button
          type="button"
          className={`${btn} ${btnSmall} ${ghost}`}
          disabled={onRecommended}
          onClick={() => save({ queue: { ...RECOMMENDED_QUEUE_RULES } })}
        >
          {onRecommended ? t.onRecommended : t.resetRecommended}
        </button>
      </div>
      <p className={lead}>{t.rulesLead}</p>
      <div className={panel}>
        {[...TWITCH_RULES, 'newInCustom' as const].map((rule) => {
          const { name, note } = t.ruleNames[rule]
          const options = t.ruleOptions[rule] as Record<string, string>
          return (
            <Row key={rule} name={name} note={note}>
              <select
                className={select}
                aria-label={name}
                value={settings.queue[rule]}
                onChange={(event) =>
                  save({ queue: { [rule]: event.target.value } } as SettingsPatchInput)
                }
              >
                {Object.entries(options).map(([value, label]) => (
                  <option key={value} value={value}>
                    {value === recommendedOf(rule) ? t.recommended(label) : label}
                  </option>
                ))}
              </select>
            </Row>
          )
        })}
        <Row name={linkedName} note={linkedNote}>
          <Toggle
            label={linkedName}
            on={settings.queue.linkedFirst}
            onChange={(on) => save({ queue: { linkedFirst: on } })}
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
      </div>
    </div>
  )
}
