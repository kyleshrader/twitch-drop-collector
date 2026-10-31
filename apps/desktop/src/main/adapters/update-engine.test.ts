import { describe, expect, it } from 'vitest'
import { describeUpdateError } from './update-engine'

describe('describeUpdateError', () => {
  it.each([
    [
      '404 \n"method: GET url: https://github.com/o/r/releases.atom"',
      'no published releases were found'
    ],
    ['HttpError: 503 Service Unavailable\nbody', 'the update server answered 503'],
    ['net::ERR_INTERNET_DISCONNECTED', 'network error (net::ERR_INTERNET_DISCONNECTED)'],
    ['sha512 checksum mismatch, expected x\nmore', 'sha512 checksum mismatch, expected x']
  ])('%s', (message, expected) => {
    expect(describeUpdateError(new Error(message))).toBe(expected)
  })
})
