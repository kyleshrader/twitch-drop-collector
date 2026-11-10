// "Report on GitHub": a new-issue link filled in with an API issue's (already redacted) details.
// It opens in the browser, where the user reads it over and submits it themselves.
import type { ApiIssueView } from '@tdc/ipc-contract'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

export const ISSUES_URL = 'https://github.com/kyleshrader/twitch-drop-collector/issues/new'
/** Browsers and GitHub cut off very long links; the body stays under this many characters. */
export const MAX_BODY = 6000
/** The API log is moved to twitch-api.old.log at this size, so at most twice this on disk. */
export const API_LOG_MAX_BYTES = 2 * 1024 * 1024

const json = (value: unknown): string => {
  if (value === undefined) return '(nothing)'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export function reportBody(
  issue: ApiIssueView,
  app: { version: string; platform: string }
): string {
  const head = [
    `**${issue.summary}**`,
    '',
    `- Endpoint: \`${issue.endpoint}\` (${issue.source})`,
    `- Kind: ${issue.kind}, ${issue.severity}`,
    `- Seen ${issue.count} time(s), first ${issue.firstAt}, last ${issue.lastAt}`,
    `- App: ${app.version} on ${app.platform}`,
    '',
    'Details were redacted by the app. Please check nothing personal is left before submitting.',
    ''
  ].join('\n')
  let body = head
  for (const check of issue.checks) {
    const part = [
      `### \`${check.path}\``,
      check.message,
      '',
      '<details><summary>Expected</summary>',
      '',
      '```json',
      json(check.expected),
      '```',
      '</details>',
      '',
      '<details><summary>Actual</summary>',
      '',
      '```json',
      check.missing ? '(missing)' : json(check.actual),
      '```',
      '</details>',
      ''
    ].join('\n')
    if (body.length + part.length > MAX_BODY) {
      body += '\n_More differences were left out; they are in twitch-api.log._\n'
      break
    }
    body += part
  }
  return body
}

export function reportUrl(issue: ApiIssueView, app: { version: string; platform: string }): string {
  const url = new URL(ISSUES_URL)
  url.searchParams.set('title', `Twitch API: ${issue.endpoint}: ${issue.summary}`.slice(0, 200))
  url.searchParams.set('body', reportBody(issue, app))
  return url.toString()
}

/** Appends to the API log, moving it aside first when it's grown too big. */
export function createLogAppender(file: string, oldFile: string): (line: string) => Promise<void> {
  let queue: Promise<void> = Promise.resolve()
  return (line) => {
    // A failed write (reported by the caller) doesn't stop later ones.
    queue = queue
      .catch(() => {})
      .then(async () => {
        const size = await stat(file).then(
          (s) => s.size,
          () => 0
        )
        if (size + line.length > API_LOG_MAX_BYTES) await rename(file, oldFile)
        await mkdir(dirname(file), { recursive: true })
        await appendFile(file, line, 'utf8')
      })
    return queue
  }
}
