// Twitch API: signs that Twitch changed something the app relies on, found by main checking every
// response. Reached from the notification bell and the Settings page, not the top bar's links.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ApiCallResult,
  ApiCheckView,
  ApiIssuesView,
  ApiIssueView,
  SettingsView
} from '@tdc/ipc-contract'
import { useState, type ReactNode } from 'react'
import { invoke } from '../../ipc'
import { API_ISSUES_KEY } from '../../live'
import { useSettingsPatch } from '../data'
import { icons } from '../icons'
import { navigate, routeHref } from '../router'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Pages.module.css'

const t = strings.twitchApi
const Icon = icons
const {
  page,
  lead,
  panel,
  actions,
  status: statusClass,
  missed,
  unclaimed,
  issueRow,
  issueMain,
  issueEndpoint,
  issueMeta,
  diffGrid,
  diffBox,
  diffPath,
  code,
  small,
  headingRow,
  callItem,
  callRow,
  callResult,
  callOk,
  callFailed,
  callDetail
} = styles
const { btn, btnSmall, ghost, green, empty, muted, selectable, chip } = ui

const SEVERITY = { error: missed ?? '', warning: unclaimed ?? '' }

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const at = (iso: string): string => when.format(new Date(iso))

const shown = (value: unknown): string =>
  value === undefined
    ? t.nothing
    : typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2)

function Severity(props: { issue: Pick<ApiIssueView, 'severity'> }): ReactNode {
  const { severity } = props.issue
  return (
    <span className={`${statusClass} ${SEVERITY[severity]}`}>
      {severity === 'error' ? <Icon.error /> : <Icon.warning />}
      {t.severity[severity]}
    </span>
  )
}

/** The list's actions: simulate a change, the log folder, pause, dismiss all. */
function Toolbar(props: {
  settings: SettingsView
  issues: ApiIssuesView
  onIssues: (view: ApiIssuesView) => void
}): ReactNode {
  const { settings, issues, onIssues } = props
  const openLogs = useMutation({ mutationFn: () => invoke('app:openLogsFolder') })
  const demo = useMutation({ mutationFn: () => invoke('apiIssues:demo'), onSuccess: onIssues })
  const dismissAll = useMutation({
    mutationFn: () => invoke('apiIssues:dismiss', {}),
    onSuccess: onIssues
  })
  return (
    <>
      <div className={actions} data-keys="row">
        <button
          type="button"
          className={btn}
          disabled={demo.isPending}
          onClick={() => demo.mutate()}
          data-tip={t.demoTip}
        >
          <Icon.demo />
          {t.demo}
        </button>
        <button type="button" className={btn} onClick={() => openLogs.mutate()}>
          <Icon.folder />
          {t.openFolder}
        </button>
        <PauseToggle settings={settings} />
        {issues.issues.length > 0 && (
          <button
            type="button"
            className={`${btn} ${ghost}`}
            disabled={dismissAll.isPending}
            onClick={() => dismissAll.mutate()}
          >
            {t.dismissAll}
          </button>
        )}
      </div>
      <PausedNote settings={settings} />
    </>
  )
}

/**
 * Test calls: the read-only requests the app uses, each run on its own or all at once, with how
 * long it took and what came back (redacted). A mismatch is recorded as an issue, as always.
 */
function TestCalls(props: { onIssues: (view: ApiIssuesView) => void }): ReactNode {
  const { onIssues } = props
  const calls = useQuery({ queryKey: ['apiCalls'], queryFn: () => invoke('apiIssues:calls') })
  const [results, setResults] = useState<Readonly<Record<string, ApiCallResult>>>({})
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<string | undefined>()
  const names = calls.data ?? []
  const run = (endpoint?: string): void => {
    const which = endpoint ? [endpoint] : names
    setRunning((was) => new Set([...was, ...which]))
    void invoke('apiIssues:check', endpoint ? { endpoint } : {})
      .then((result) => {
        onIssues(result.issues)
        setResults((was) => ({
          ...was,
          ...Object.fromEntries(result.results.map((r) => [r.endpoint, r]))
        }))
      })
      .finally(() => setRunning((was) => new Set([...was].filter((name) => !which.includes(name)))))
  }
  const done = names.filter((name) => results[name])
  const passed = done.filter((name) => results[name]?.ok).length
  return (
    <>
      <div className={headingRow}>
        <h3>{t.testCalls}</h3>
        <button
          type="button"
          className={`${btn} ${btnSmall}`}
          disabled={names.length === 0 || running.size > 0}
          onClick={() => run()}
        >
          <Icon.recheck />
          {running.size > 0 ? t.checking : t.runAll}
        </button>
      </div>
      <p className={small} style={{ margin: '0 0 10px' }}>
        {t.testCallsNote}
      </p>
      {done.length > 0 && (
        <p className={muted} role="status">
          {t.checked(passed, done.length)}
        </p>
      )}
      {names.length === 0 ? (
        <div className={empty}>{calls.isLoading ? strings.loading : t.signInToTest}</div>
      ) : (
        <div className={panel} data-keys="list" aria-label={t.testCalls}>
          {names.map((name) => {
            const result = results[name]
            const busy = running.has(name)
            return (
              <div key={name} className={callItem} data-testid="api-call">
                <div className={callRow}>
                  <span className={issueEndpoint}>{name}</span>
                  <span className={callResult}>
                    {busy ? (
                      t.checking
                    ) : result ? (
                      <span className={result.ok ? callOk : callFailed}>
                        {result.ok ? <Icon.check /> : <Icon.error />}
                        {result.ok ? t.passed(result.ms) : t.failed(result.ms)}
                      </span>
                    ) : (
                      <span className={muted}>{t.notRun}</span>
                    )}
                  </span>
                  {result && (
                    <button
                      type="button"
                      className={`${btn} ${btnSmall} ${ghost}`}
                      aria-expanded={open === name}
                      onClick={() => setOpen(open === name ? undefined : name)}
                    >
                      {open === name ? t.hideResponse : t.showResponse}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${btn} ${btnSmall}`}
                    disabled={busy}
                    onClick={() => run(name)}
                    aria-label={t.runOne(name)}
                  >
                    <Icon.play />
                    {t.run}
                  </button>
                </div>
                {result && open === name && (
                  <div className={callDetail}>
                    {result.error && <p className={callFailed}>{result.error}</p>}
                    <pre className={code} tabIndex={0}>
                      {shown(result.response)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

/** Pause all activity / Resume: the same pause as the Drops page's, which stops all Twitch traffic. */
function PauseToggle(props: { settings: SettingsView }): ReactNode {
  const { save, saving } = useSettingsPatch()
  const onChange = (paused: boolean): void => save({ queue: { paused } })
  return props.settings.queue.paused ? (
    <button
      type="button"
      className={`${btn} ${green}`}
      disabled={saving}
      onClick={() => onChange(false)}
    >
      <Icon.play />
      {t.resume}
    </button>
  ) : (
    <button type="button" className={btn} disabled={saving} onClick={() => onChange(true)}>
      <Icon.pause />
      {t.pause}
    </button>
  )
}

function PausedNote(props: { settings: SettingsView }): ReactNode {
  return props.settings.queue.paused ? <p className={small}>{t.pausedNote}</p> : null
}

function IssueList(props: { issues: ApiIssuesView }): ReactNode {
  const { issues } = props
  if (issues.issues.length === 0) return <div className={empty}>{t.none}</div>
  return (
    <div className={panel} data-keys="list" aria-label={t.heading}>
      {issues.issues.map((issue) => (
        <a
          key={issue.id}
          className={issueRow}
          href={routeHref({ page: 'twitchApi', issueId: issue.id })}
          data-testid="api-issue"
        >
          <Severity issue={issue} />
          <span className={issueMain}>
            <span className={issueEndpoint}>
              {issue.endpoint} {issue.demo && <span className={chip}>{t.demoChip}</span>}
            </span>
            <span>{issue.summary}</span>
          </span>
          <span className={issueMeta}>
            {t.kind[issue.kind]} · {t.times(issue.count)}
            <br />
            {t.lastSeen(at(issue.lastAt))}
          </span>
        </a>
      ))}
    </div>
  )
}

function Difference(props: { check: ApiCheckView }): ReactNode {
  const { check } = props
  return (
    <div className={panel} style={{ padding: 14, marginBottom: 10 }}>
      <div className={diffPath}>
        <code className={selectable}>{check.path}</code>
        <span className={muted}>{check.message}</span>
      </div>
      <div className={diffGrid}>
        <div className={diffBox}>
          <b>{t.expected}</b>
          <pre className={code} tabIndex={0}>
            {shown(check.expected)}
          </pre>
        </div>
        <div className={diffBox}>
          <b>{t.actual}</b>
          <pre className={code} tabIndex={0}>
            {check.missing ? t.missing : shown(check.actual)}
          </pre>
        </div>
      </div>
    </div>
  )
}

function IssueDetail(props: {
  issue: ApiIssueView | undefined
  settings: SettingsView
  onIssues: (view: ApiIssuesView) => void
}): ReactNode {
  const { issue, settings, onIssues } = props
  const dismiss = useMutation({
    mutationFn: (id: string) => invoke('apiIssues:dismiss', { id }),
    onSuccess: (view) => {
      onIssues(view)
      navigate({ page: 'twitchApi' })
    }
  })
  const report = useMutation({ mutationFn: (id: string) => invoke('apiIssues:report', { id }) })
  if (!issue) return <div className={empty}>{t.notFound}</div>
  return (
    <>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Severity issue={issue} />
        <span className={`${issueEndpoint} ${selectable}`}>{issue.endpoint}</span>
        {issue.demo && <span className={chip}>{t.demoChip}</span>}
      </h3>
      <p className={selectable}>{issue.summary}</p>
      <p className={muted}>
        {t.source[issue.source]} · {t.kind[issue.kind]} ·{' '}
        {t.seen(issue.count, at(issue.firstAt), at(issue.lastAt))}
      </p>
      <div className={actions} data-keys="row">
        <button type="button" className={btn} onClick={() => report.mutate(issue.id)}>
          <Icon.report />
          {t.report}
        </button>
        <button
          type="button"
          className={`${btn} ${ghost}`}
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate(issue.id)}
        >
          {t.dismiss}
        </button>
        <PauseToggle settings={settings} />
      </div>
      <PausedNote settings={settings} />
      <p className={small}>{t.reportNote}</p>
      <h3>{t.differences}</h3>
      {issue.checks.map((check, i) => (
        <Difference key={`${check.path}:${i}`} check={check} />
      ))}
      {issue.response !== undefined && (
        <details>
          <summary>{t.response}</summary>
          <pre className={code} tabIndex={0}>
            {shown(issue.response)}
          </pre>
        </details>
      )}
    </>
  )
}

export function TwitchApiPage(props: {
  issues: ApiIssuesView | undefined
  settings: SettingsView
  issueId: string | undefined
}): ReactNode {
  const { issues, settings, issueId } = props
  const queryClient = useQueryClient()
  const onIssues = (view: ApiIssuesView): void => {
    queryClient.setQueryData(API_ISSUES_KEY, view)
  }
  if (!issues) return null
  return (
    <div className={page}>
      {issueId ? (
        <a className={`${btn} ${btnSmall} ${ghost}`} href={routeHref({ page: 'twitchApi' })}>
          <Icon.back />
          {t.back}
        </a>
      ) : (
        <h2>{t.heading}</h2>
      )}
      {!issueId && (
        <p className={lead}>
          {t.lead(issues.logFile)} <b>{t.counts(issues.errors, issues.warnings)}.</b>
        </p>
      )}
      {issueId ? (
        <IssueDetail
          issue={issues.issues.find((i) => i.id === issueId)}
          settings={settings}
          onIssues={onIssues}
        />
      ) : (
        <>
          <Toolbar settings={settings} issues={issues} onIssues={onIssues} />
          <h3>{t.issuesHeading}</h3>
          <IssueList issues={issues} />
          <TestCalls onIssues={onIssues} />
        </>
      )}
    </div>
  )
}
