import { describe, expect, it } from 'vitest'
import { validProxy } from './settings'

describe('the proxy field', () => {
  it('accepts empty, http(s) and socks(5) addresses with a host', () => {
    for (const ok of [
      '',
      'http://proxy:8080',
      'https://p.example',
      'socks5://127.0.0.1:1080',
      'socks://h'
    ]) {
      expect(validProxy(ok)).toBe(true)
    }
  })

  it('rejects other schemes and text that is not an address', () => {
    for (const bad of ['ftp://x', 'proxy:8080', 'localhost', 'http://']) {
      expect(validProxy(bad)).toBe(false)
    }
  })
})
