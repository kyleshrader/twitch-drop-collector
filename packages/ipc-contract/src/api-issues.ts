// Signs that Twitch changed its API: responses that didn't match what the app expects, recorded
// by main (redacted) and shown on the Twitch API page.
import { z } from 'zod'

export const ApiIssueSeverity = z.enum(['error', 'warning'])
export type ApiIssueSeverity = z.infer<typeof ApiIssueSeverity>

export const ApiCheckView = z.object({
  /** Where in the response, e.g. currentUser.inventory.dropCampaignsInProgress.0.id. */
  path: z.string(),
  message: z.string(),
  /** What the app expected there (a JSON Schema fragment or a description). */
  expected: z.unknown().optional(),
  /** What came back there, redacted. */
  actual: z.unknown().optional(),
  /** Nothing came back at path. */
  missing: z.boolean().optional()
})
export type ApiCheckView = z.infer<typeof ApiCheckView>

export const ApiIssueView = z.object({
  id: z.string(),
  severity: ApiIssueSeverity,
  source: z.enum(['gql', 'pubsub', 'identity']),
  /** The GQL operation, PubSub topic or identity endpoint. */
  endpoint: z.string(),
  kind: z.enum(['shape', 'error', 'http', 'partial', 'retried']),
  summary: z.string(),
  checks: z.array(ApiCheckView),
  /** The response it's about, redacted and trimmed. */
  response: z.unknown().optional(),
  /** ISO times: first and last seen. */
  firstAt: z.string(),
  lastAt: z.string(),
  /** How many times it happened. */
  count: z.number().int().min(1),
  /** Made up by "Simulate a change" to try the page and the notification; not from Twitch. */
  demo: z.boolean().optional()
})
export type ApiIssueView = z.infer<typeof ApiIssueView>

export const ApiIssuesView = z.object({
  /** Issues not dismissed, newest first. */
  issues: z.array(ApiIssueView),
  errors: z.number().int().min(0),
  warnings: z.number().int().min(0),
  /** The log file's name in the logs folder. */
  logFile: z.string()
})
export type ApiIssuesView = z.infer<typeof ApiIssuesView>

/** One issue, or every issue when no id is given. */
export const DismissApiIssueInput = z.object({ id: z.string().max(200).optional() })
export type DismissApiIssueInput = z.infer<typeof DismissApiIssueInput>

export const ReportApiIssueInput = z.object({ id: z.string().min(1).max(200) })
export type ReportApiIssueInput = z.infer<typeof ReportApiIssueInput>

/** One read-only Twitch request, run on demand. */
export const ApiCallResult = z.object({
  endpoint: z.string(),
  ok: z.boolean(),
  /** How long it took. */
  ms: z.number().min(0),
  /** Why it failed. */
  error: z.string().optional(),
  /** What came back, redacted and trimmed. */
  response: z.unknown().optional()
})
export type ApiCallResult = z.infer<typeof ApiCallResult>

/** Runs one of the read-only requests (by endpoint name), or all of them. */
export const ApiCheckInput = z.object({ endpoint: z.string().min(1).max(100).optional() })
export type ApiCheckInput = z.infer<typeof ApiCheckInput>

/** Test calls: how each request went; mismatches are recorded as issues too. */
export const ApiCheckResult = z.object({
  results: z.array(ApiCallResult),
  issues: ApiIssuesView
})
export type ApiCheckResult = z.infer<typeof ApiCheckResult>
