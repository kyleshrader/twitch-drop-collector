import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { followLiveState } from './live'
import { NextApp } from './next/NextApp'

const queryClient = new QueryClient()
followLiveState(queryClient)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <NextApp />
    </QueryClientProvider>
  </StrictMode>
)
