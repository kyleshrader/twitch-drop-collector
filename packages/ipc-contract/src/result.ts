// Main replies with a plain envelope instead of throwing: Error subclasses lose their fields
// crossing contextBridge, while plain objects arrive intact.
import type { InvokeChannel, InvokeOutput } from './channels'

export type IpcErrorCode =
  'UNKNOWN_CHANNEL' | 'FORBIDDEN_SENDER' | 'INVALID_INPUT' | 'HANDLER_FAILED' | 'INVALID_OUTPUT'

export interface IpcFailure {
  code: IpcErrorCode
  message: string
  /** Validation issues for INVALID_INPUT, as "path: message" strings. */
  issues?: string[]
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcFailure }

export class IpcError extends Error {
  readonly code: IpcErrorCode
  readonly issues: string[]

  constructor(channel: string, failure: IpcFailure) {
    super(`${channel}: ${failure.code}: ${failure.message}`)
    this.name = 'IpcError'
    this.code = failure.code
    this.issues = failure.issues ?? []
  }
}

/** What the preload script exposes as window.api. */
export interface PreloadApi {
  invoke<C extends InvokeChannel>(channel: C, input?: unknown): Promise<IpcResult<InvokeOutput<C>>>
}
