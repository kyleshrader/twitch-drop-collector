// A GqlClient for service tests: each operation (by name) is answered by a handler.
import type { GqlClient, GqlOperation } from '@tdc/api'
import type { Logger } from '@tdc/kernel'
import { vi } from 'vitest'

export type GqlHandler = (input: unknown) => unknown | Promise<unknown>

export interface FakeGql extends GqlClient {
  handle(operationName: string, handler: GqlHandler): void
  /** Inputs each operation was called with, in order. */
  calls: Record<string, unknown[]>
}

export function fakeGql(handlers: Record<string, GqlHandler> = {}): FakeGql {
  const routes = new Map(Object.entries(handlers))
  const calls: Record<string, unknown[]> = {}
  const answer = async <V, D>(operation: GqlOperation<V, D>, input: V): Promise<D> => {
    ;(calls[operation.name] ??= []).push(input)
    const handler = routes.get(operation.name)
    if (!handler) throw new Error(`fakeGql: no handler for ${operation.name}`)
    // Validate like the real client, so fakes can't drift from the schemas.
    return operation.data.parse(await handler(input))
  }
  return {
    calls,
    handle: (name, handler) => routes.set(name, handler),
    request: (operation, input) => answer(operation, input),
    batch: (operation, inputs) => Promise.all(inputs.map((input) => answer(operation, input)))
  }
}

export function testLogger(): Logger {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return logger
}
