import { describe, expect, it } from 'vitest'
import { CORE_DEPENDENCIES } from './index'

describe('@tdc/core', () => {
  it('resolves its workspace dependencies', () => {
    expect(CORE_DEPENDENCIES).toEqual(['@tdc/api', '@tdc/config', '@tdc/storage'])
  })
})
