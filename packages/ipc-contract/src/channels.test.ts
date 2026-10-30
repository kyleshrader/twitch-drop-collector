import { describe, expect, it } from 'vitest'
import { invokeChannels, isInvokeChannel, OpenExternalInput } from './channels'

describe('isInvokeChannel', () => {
  it('accepts contract channels only', () => {
    expect(isInvokeChannel('app:getInfo')).toBe(true)
    expect(isInvokeChannel('toString')).toBe(false)
    expect(isInvokeChannel('__proto__')).toBe(false)
    expect(isInvokeChannel(42)).toBe(false)
  })
})

describe('OpenExternalInput', () => {
  it('accepts https URLs', () => {
    expect(
      OpenExternalInput.safeParse({ url: 'https://www.twitch.tv/drops/inventory' }).success
    ).toBe(true)
  })

  it.each([
    { url: 'http://www.twitch.tv' },
    { url: 'file:///etc/passwd' },
    { url: 'javascript:alert(1)' },
    { url: 'not a url' },
    { url: 42 },
    {},
    null
  ])('rejects %j', (input) => {
    expect(OpenExternalInput.safeParse(input).success).toBe(false)
  })
})

describe('app:getInfo', () => {
  it('takes no input', () => {
    expect(invokeChannels['app:getInfo'].input.safeParse(undefined).success).toBe(true)
    expect(invokeChannels['app:getInfo'].input.safeParse({ any: 'thing' }).success).toBe(false)
  })
})
