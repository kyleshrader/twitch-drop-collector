import { describe, expect, it } from 'vitest'
import { CORE_DEPENDENCIES, SUPPORTED_DATABASE_VERSION, SUPPORTED_SETTINGS_VERSION } from './index'

describe('@tdc/core', () => {
  it('resolves its workspace dependencies', () => {
    expect(CORE_DEPENDENCIES).toEqual(['@tdc/api'])
    expect(SUPPORTED_SETTINGS_VERSION).toBeGreaterThan(0)
    expect(SUPPORTED_DATABASE_VERSION).toBeGreaterThan(0)
  })
})
