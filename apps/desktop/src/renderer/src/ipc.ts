import { IpcError, type InvokeArgs, type InvokeChannel, type InvokeOutput } from '@tdc/ipc-contract'

/** Typed request to main. Rejects with IpcError when main refuses or the handler fails. */
export async function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeOutput<C>> {
  const result = await window.api.invoke(channel, args[0])
  if (!result.ok) throw new IpcError(channel, result.error)
  return result.value
}
