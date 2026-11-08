import type { z } from 'zod'

/**
 * A GQL operation. Most are persisted queries: Twitch looks them up by name and hash, so no query
 * text is sent. A few that Twitch's own clients don't persist under a hash we know are sent as
 * query text instead.
 */
export type GqlOperation<Variables, Data> = {
  /** The operationName Twitch expects (for query text, the name the query declares). */
  name: string
  variables: (input: Variables) => Record<string, unknown>
  /** Schema for the response's `data` object. */
  data: z.ZodType<Data>
} & ({ sha256: string; query?: never } | { query: string; sha256?: never })

export function defineOperation<Variables, Data>(
  operation: GqlOperation<Variables, Data>
): GqlOperation<Variables, Data> {
  return operation
}

export function toPayload<V, D>(operation: GqlOperation<V, D>, input: V): Record<string, unknown> {
  const variables = operation.variables(input)
  if (operation.query !== undefined) {
    return { operationName: operation.name, query: operation.query, variables }
  }
  return {
    operationName: operation.name,
    extensions: { persistedQuery: { version: 1, sha256Hash: operation.sha256 } },
    variables
  }
}
