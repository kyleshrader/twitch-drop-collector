// Signed out: a compact box with a big Sign in button, and a waiting state for the login window.
import { useMutation } from '@tanstack/react-query'
import type { AuthStateView } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { invoke } from '../../ipc'
import { useUiChoice } from '../../ui-choice'
import { icons } from '../icons'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Pages.module.css'

const t = strings.signedOut
const Icon = icons
const { signedOut, signInBox, signInMark, signInButton, waiting, waitBar, signInExtra } = styles
const { btn, btnLarge, btnSmall, green, ghost, visuallyHidden } = ui

export function SignedOut(props: { auth: AuthStateView | undefined }): ReactNode {
  const { auth } = props
  const { switchTo, switching, failed } = useUiChoice()
  const signIn = useMutation({ mutationFn: () => invoke('auth:signIn', { method: 'loginWindow' }) })
  const cancel = useMutation({ mutationFn: () => invoke('auth:cancelSignIn') })
  const isWaiting = auth?.status === 'signingIn'
  const restoring = !auth || auth.status === 'restoring'
  const status = restoring
    ? t.restoring
    : auth.status === 'signedOut'
      ? (auth.message ?? t.status)
      : isWaiting
        ? t.waiting
        : ''

  return (
    <div className={signedOut}>
      <div className={`${signInBox} ${isWaiting || restoring ? waiting : ''}`}>
        <div className={signInMark}>
          <Icon.brand />
        </div>
        <h2>{t.heading}</h2>
        <p>{t.lead}</p>
        <span className={visuallyHidden} role="status">
          {status}
        </span>
        {isWaiting || restoring ? (
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
        <div className={signInExtra}>
          {isWaiting && (
            <button
              type="button"
              className={`${btn} ${btnSmall} ${ghost}`}
              onClick={() => cancel.mutate()}
            >
              {t.cancel}
            </button>
          )}
          <button
            type="button"
            className={`${btn} ${btnSmall} ${ghost}`}
            disabled={switching}
            onClick={() => switchTo('classic')}
          >
            {switching ? strings.switching : strings.backToClassic}
          </button>
        </div>
        {failed && <p role="alert">{strings.switchFailed}</p>}
      </div>
    </div>
  )
}
