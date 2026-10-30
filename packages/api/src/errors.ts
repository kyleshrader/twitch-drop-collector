/** Every attempt failed (connection errors, timeouts or 5xx responses). */
export class RequestFailedError extends Error {
  constructor(
    readonly url: string,
    readonly attempts: number,
    options?: { cause?: unknown }
  ) {
    super(`Request to ${url} failed after ${attempts} attempt(s)`, options)
    this.name = 'RequestFailedError'
  }
}

/** Twitch's GQL API returned an error we don't retry. */
export class GqlError extends Error {
  constructor(
    readonly operation: string,
    message: string,
    readonly details?: unknown
  ) {
    super(`${operation}: ${message}`)
    this.name = 'GqlError'
  }
}

/** A response didn't match the schema we expect; Twitch probably changed something. */
export class ResponseShapeError extends Error {
  constructor(
    readonly operation: string,
    readonly issues: string[]
  ) {
    super(`${operation}: unexpected response shape (${issues.slice(0, 3).join('; ')})`)
    this.name = 'ResponseShapeError'
  }
}
