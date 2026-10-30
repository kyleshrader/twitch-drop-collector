import { describe, expect, it } from 'vitest'
import {
  SUPPORTED_DATABASE_VERSION,
  SUPPORTED_GQL_BATCH_SIZE,
  SUPPORTED_SETTINGS_VERSION
} from './index'

describe('@tdc/core', () => {
  it('resolves its workspace dependencies', () => {
    expect(SUPPORTED_GQL_BATCH_SIZE).toBe(20)
    expect(SUPPORTED_SETTINGS_VERSION).toBeGreaterThan(0)
    expect(SUPPORTED_DATABASE_VERSION).toBeGreaterThan(0)
  })
})
