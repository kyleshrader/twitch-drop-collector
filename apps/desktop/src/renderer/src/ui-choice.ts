// Which UI the window shows (settings → general.ui). Both UIs switch through this, so the new
// one can be built in place while the classic one stays a click away.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SettingsView } from '@tdc/ipc-contract'
import { invoke } from './ipc'
import { SETTINGS_KEY, useSettings } from './live'

export type UiChoice = SettingsView['general']['ui']

export function useUiChoice(): {
  ui: UiChoice | undefined
  switchTo: (ui: UiChoice) => void
  switching: boolean
  failed: boolean
} {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (ui: UiChoice) => invoke('settings:update', { general: { ui } }),
    // The window's root follows the cached settings, so this switches the UI.
    onSuccess: (saved) => queryClient.setQueryData(SETTINGS_KEY, saved)
  })
  return {
    ui: useSettings()?.general.ui,
    switchTo: (ui) => save.mutate(ui),
    switching: save.isPending,
    failed: save.isError
  }
}
