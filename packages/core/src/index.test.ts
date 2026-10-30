import { describe, expect, it } from 'vitest'
import { CORE_DEPENDENCIES, SUPPORTED_SETTINGS_VERSION } from './index'

describe('@tdc/core', () => {
  it('resolves its workspace dependencies', () => {
    expect(CORE_DEPENDENCIES).toEqual(['@tdc/api', '@tdc/storage'])
    expect(SUPPORTED_SETTINGS_VERSION).toBeGreaterThan(0)
  })
})
