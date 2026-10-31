// The IPC transport schema mirrors @tdc/config's schema. These assertions fail the typecheck when
// a field is added to one and not the other; the runtime checks catch rule differences
// (enums, ranges) that types alone can't see.
import { DEFAULT_SETTINGS, Settings, SettingsPatch } from '@tdc/config'
import { SettingsPatchInput, SettingsView } from '@tdc/ipc-contract'
import { describe, expect, expectTypeOf, it } from 'vitest'

describe('settings transport schema', () => {
  it('has the same type as the config schema', () => {
    expectTypeOf<SettingsView>().toEqualTypeOf<Settings>()
    expectTypeOf<SettingsPatchInput>().toEqualTypeOf<SettingsPatch>()
  })

  it('accepts and rejects the same values', () => {
    const samples: unknown[] = [
      DEFAULT_SETTINGS,
      { ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, theme: 'neon' } },
      { ...DEFAULT_SETTINGS, network: { proxy: 'socks5://127.0.0.1:1080', connectionQuality: 6 } },
      { ...DEFAULT_SETTINGS, network: { proxy: 'ftp://x', connectionQuality: 1 } },
      { ...DEFAULT_SETTINGS, network: { proxy: '', connectionQuality: 7 } },
      { ...DEFAULT_SETTINGS, mining: { ...DEFAULT_SETTINGS.mining, priority: ['  '] } },
      {
        ...DEFAULT_SETTINGS,
        updates: { mode: 'auto', prereleases: true, skippedVersion: '1.2.3' }
      },
      { ...DEFAULT_SETTINGS, updates: { mode: 'auto', prereleases: true, skippedVersion: 'v1' } },
      { ...DEFAULT_SETTINGS, updates: { ...DEFAULT_SETTINGS.updates, mode: 'always' } }
    ]
    for (const sample of samples) {
      expect(SettingsView.safeParse(sample).success).toBe(Settings.safeParse(sample).success)
    }

    const patches: unknown[] = [
      { general: { theme: 'dark' } },
      { general: { theme: 'neon' } },
      { network: { connectionQuality: 0 } },
      { logging: { level: 'trace' } },
      { updates: { skippedVersion: '2.0.0-beta.1' } },
      { updates: { skippedVersion: '../2.0.0' } },
      { general: { unknown: true } },
      { other: {} }
    ]
    for (const patch of patches) {
      expect(SettingsPatchInput.safeParse(patch).success).toBe(
        SettingsPatch.safeParse(patch).success
      )
    }
  })
})
