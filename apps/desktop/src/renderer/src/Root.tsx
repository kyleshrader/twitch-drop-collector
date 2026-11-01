// The window's root: the classic UI, or the new one while it's in preview (settings → general.ui).
import type { ReactNode } from 'react'
import App from './App'
import { NextApp } from './next/NextApp'
import { useUiChoice } from './ui-choice'

export function Root(): ReactNode {
  const { ui } = useUiChoice()
  // Settings load in a moment; show nothing rather than flash the wrong UI.
  if (ui === undefined) return null
  return ui === 'next' ? <NextApp /> : <App />
}
