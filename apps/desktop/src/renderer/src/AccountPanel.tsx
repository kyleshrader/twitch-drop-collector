// Temporary account panel: Twitch sign-in state and the two sign-in methods.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthStateView } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { invoke } from './ipc'
import { strings } from './strings'

const AUTH_KEY = ['auth'] as const
const t = strings.account

export function AccountPanel(): ReactNode {
  const queryClient = useQueryClient()
  const auth = useQuery({
    queryKey: AUTH_KEY,
    queryFn: () => invoke('auth:getState'),
    // Until main pushes changes (M8), poll while something is in progress.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'signingIn' || status === 'restoring' ? 1000 : false
    }
  })
  const refresh = (state?: AuthStateView): void => {
    if (state) queryClient.setQueryData(AUTH_KEY, state)
    else void queryClient.invalidateQueries({ queryKey: AUTH_KEY })
  }
  const signIn = useMutation({
    mutationFn: (method: 'loginWindow' | 'deviceCode') => invoke('auth:signIn', { method }),
    onSuccess: () => refresh()
  })
  const cancel = useMutation({ mutationFn: () => invoke('auth:cancelSignIn'), onSuccess: refresh })
  const signOut = useMutation({ mutationFn: () => invoke('auth:signOut'), onSuccess: refresh })
  const openLink = useMutation({
    mutationFn: (url: string) => invoke('shell:openExternal', { url })
  })

  const state = auth.data
  return (
    <section aria-labelledby="account-heading">
      <h2 id="account-heading">{t.heading}</h2>
      {!state || state.status === 'restoring' ? (
        <p role="status">{t.restoring}</p>
      ) : state.status === 'signedIn' ? (
        <>
          <p role="status" data-testid="auth-status">
            {t.signedInAs(state.user.login)}
            {!state.verified && ` ${t.unverified}`}
          </p>
          <button type="button" onClick={() => signOut.mutate()}>
            {t.signOut}
          </button>
        </>
      ) : state.status === 'signingIn' ? (
        <>
          <p role="status" data-testid="auth-status">
            {state.method === 'loginWindow' ? t.waitingForWindow : t.waitingForCode}
          </p>
          {state.deviceCode && (
            <p>
              {t.enterCode} <strong data-testid="device-code">{state.deviceCode.userCode}</strong>{' '}
              <button
                type="button"
                onClick={() => openLink.mutate(state.deviceCode!.verificationUri)}
              >
                {t.openActivate}
              </button>
            </p>
          )}
          <button type="button" onClick={() => cancel.mutate()}>
            {t.cancel}
          </button>
        </>
      ) : (
        <>
          <p role="status" data-testid="auth-status">
            {state.message ?? t.signedOut}
          </p>
          {/* Code sign-in only for now; the login-window strategy stays in main for later. */}
          <p>
            <button type="button" onClick={() => signIn.mutate('deviceCode')}>
              {t.signIn}
            </button>{' '}
            {t.signInNote}
          </p>
        </>
      )}
    </section>
  )
}
