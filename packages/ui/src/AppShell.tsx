import type { ReactNode } from 'react'

export function AppShell({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  )
}
