import type { z } from 'zod'

/** A persisted GQL query: Twitch looks it up by name and hash, so no query text is sent. */
export interface GqlOperation<Variables, Data> {
  /** The operationName Twitch expects. */
  name: string
  sha256: string
  variables: (input: Variables) => Record<string, unknown>
  /** Schema for the response's `data` object. */
  data: z.ZodType<Data>
}

export function defineOperation<Variables, Data>(
  operation: GqlOperation<Variables, Data>
): GqlOperation<Variables, Data> {
  return operation
}

export function toPayload<V, D>(operation: GqlOperation<V, D>, input: V): Record<string, unknown> {
  return {
    operationName: operation.name,
    extensions: { persistedQuery: { version: 1, sha256Hash: operation.sha256 } },
    variables: operation.variables(input)
  }
}
