// Temporary account panel: Twitch sign-in state and the two sign-in methods.
import { useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { invoke } from './ipc'
import { useAuthState } from './live'
import { strings } from './strings'

const t = strings.account

export function AccountPanel(): ReactNode {
  // Main pushes every auth change, so the panel follows sign-in progress without polling.
  const state = useAuthState()
  const signIn = useMutation({
    mutationFn: (method: 'loginWindow' | 'deviceCode') => invoke('auth:signIn', { method })
  })
  const cancel = useMutation({ mutationFn: () => invoke('auth:cancelSignIn') })
  const signOut = useMutation({ mutationFn: () => invoke('auth:signOut') })
  const openLink = useMutation({
    mutationFn: (url: string) => invoke('shell:openExternal', { url })
  })

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
          {/* Login window only, as upstream: only the Android app client can see campaigns. The
              device-code strategy stays in main for later (docs/decisions.md). */}
          <p>
            <button type="button" onClick={() => signIn.mutate('loginWindow')}>
              {t.signIn}
            </button>{' '}
            {t.signInNote}
          </p>
        </>
      )}
    </section>
  )
}
