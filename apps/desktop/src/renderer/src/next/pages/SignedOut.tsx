// Signed out: a compact box with a big Sign in button, and a waiting state while signing in. A
// device-code sign-in (started through IPC; not offered as a button) shows its code here.
import { useMutation } from '@tanstack/react-query'
import type { AuthStateView } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { invoke } from '../../ipc'
import { useOpenExternal } from '../data'
import { icons } from '../icons'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Pages.module.css'

const t = strings.signedOut
const Icon = icons
const {
  signedOut,
  signInBox,
  signInMark,
  signInButton,
  waiting,
  waitBar,
  signInExtra,
  deviceCode
} = styles
const { btn, btnLarge, btnSmall, green, ghost, visuallyHidden, selectable } = ui

export function SignedOut(props: { auth: AuthStateView | undefined }): ReactNode {
  const { auth } = props
  const openExternal = useOpenExternal()
  const signIn = useMutation({ mutationFn: () => invoke('auth:signIn', { method: 'loginWindow' }) })
  const cancel = useMutation({ mutationFn: () => invoke('auth:cancelSignIn') })
  const isWaiting = auth?.status === 'signingIn'
  const code = auth?.status === 'signingIn' ? auth.deviceCode : undefined
  const restoring = !auth || auth.status === 'restoring'
  const status = restoring
    ? t.restoring
    : auth.status === 'signedOut'
      ? (auth.message ?? t.status)
      : code
        ? t.waitingForCode
        : isWaiting
          ? t.waiting
          : ''

  return (
    <div className={signedOut}>
      <div className={`${signInBox} ${(isWaiting && !code) || restoring ? waiting : ''}`}>
        <div className={signInMark}>
          <Icon.brand />
        </div>
        <h2>{t.heading}</h2>
        <p>{t.lead}</p>
        <span className={visuallyHidden} role="status" data-testid="auth-status">
          {status}
        </span>
        {code ? (
          <div className={deviceCode}>
            <span>{t.waitingForCode}</span>
            <strong className={selectable} data-testid="device-code">
              {code.userCode}
            </strong>
            <button
              type="button"
              className={`${btn} ${green}`}
              onClick={() => openExternal(code.verificationUri)}
            >
              <Icon.external />
              {t.openActivate}
            </button>
          </div>
        ) : isWaiting || restoring ? (
          <div className={waitBar} aria-hidden="true">
            <Icon.loading />
            {restoring ? t.restoring : t.waiting}
          </div>
        ) : (
          <button
            type="button"
            className={`${btn} ${btnLarge} ${green} ${signInButton}`}
            disabled={signIn.isPending}
            onClick={() => signIn.mutate()}
          >
            {t.signIn}
          </button>
        )}
        {isWaiting && (
          <div className={signInExtra}>
            <button
              type="button"
              className={`${btn} ${btnSmall} ${ghost}`}
              onClick={() => cancel.mutate()}
            >
              {t.cancel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
