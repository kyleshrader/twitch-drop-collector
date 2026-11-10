// "Simulate a change" on the Twitch API page: a made-up response checked against a real schema,
// reported like a real mismatch, so the log, the notification and the page can be tried without
// waiting for Twitch to change something. Nothing is sent to Twitch.
import { gql, shapeChecks, type ApiIssue } from '@tdc/api'

/** The avatar query, as if Twitch now sent the picture's address as an object. */
const CHANGED_RESPONSE = {
  user: { profileImageURL: { url: 'https://static-cdn.jtvnw.net/example.png', width: 70 } }
}

export function demoIssue(): ApiIssue {
  const schema = gql.UserAvatar.data
  const parsed = schema.safeParse(CHANGED_RESPONSE)
  const checks = parsed.success ? [] : shapeChecks(schema, CHANGED_RESPONSE, parsed.error)
  return {
    severity: 'error',
    source: 'gql',
    endpoint: gql.UserAvatar.name,
    kind: 'shape',
    summary: 'Demo: the response doesn’t match what we expect (made up, not from Twitch)',
    checks,
    response: CHANGED_RESPONSE,
    demo: true
  }
}
