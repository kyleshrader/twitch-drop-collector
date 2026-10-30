// Validates every renderer request before a handler sees it. Pure: no Electron imports, so the
// rejection paths are unit-tested directly.
import {
  invokeChannels,
  isInvokeChannel,
  type InvokeChannel,
  type InvokeOutput,
  type IpcFailure,
  type IpcResult
} from '@tdc/ipc-contract'
import type { Logger } from '@tdc/kernel'
import type { z } from 'zod'

type ParsedInput<C extends InvokeChannel> = z.output<(typeof invokeChannels)[C]['input']>

export type InvokeHandlers = {
  [C in InvokeChannel]: (input: ParsedInput<C>) => Promise<InvokeOutput<C>> | InvokeOutput<C>
}

export type InvokeRoute = (
  channel: string,
  rawInput: unknown,
  senderUrl: string | undefined
) => Promise<IpcResult<unknown>>

function fail(code: IpcFailure['code'], message: string, issues?: string[]): IpcResult<never> {
  return { ok: false, error: issues ? { code, message, issues } : { code, message } }
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(input)'}: ${issue.message}`)
}

export function createInvokeRouter(deps: {
  handlers: InvokeHandlers
  isTrustedSender: (url: string) => boolean
  logger: Logger
}): InvokeRoute {
  const { handlers, isTrustedSender, logger } = deps

  return async (channel, rawInput, senderUrl) => {
    if (!isInvokeChannel(channel)) {
      logger.warn('Rejected unknown IPC channel', { channel })
      return fail('UNKNOWN_CHANNEL', 'Unknown channel')
    }
    // Electron security checklist: validate the sender of every IPC message.
    if (senderUrl === undefined || !isTrustedSender(senderUrl)) {
      logger.warn('Rejected IPC from untrusted sender', { channel, senderUrl })
      return fail('FORBIDDEN_SENDER', 'Sender is not the app renderer')
    }

    const definition = invokeChannels[channel]
    const input = definition.input.safeParse(rawInput)
    if (!input.success) {
      const issues = describeIssues(input.error)
      logger.warn('Rejected invalid IPC input', { channel, issues })
      return fail('INVALID_INPUT', 'Invalid input', issues)
    }

    let value: unknown
    try {
      const handler = handlers[channel] as (input: unknown) => unknown
      value = await handler(input.data)
    } catch (error) {
      // Details stay in the main-process log; the renderer gets a generic message.
      logger.error('IPC handler failed', { channel, error })
      return fail('HANDLER_FAILED', 'The request failed')
    }

    const output = definition.output.safeParse(value)
    if (!output.success) {
      logger.error('IPC handler returned invalid output', {
        channel,
        issues: describeIssues(output.error)
      })
      return fail('INVALID_OUTPUT', 'The request failed')
    }
    return { ok: true, value: output.data }
  }
}
