import { describe, expect, it } from 'vitest'
import { dateBucket, duration } from './format'

// Local times, so the test holds in any time zone. Wednesday 18 November 2026, 15:00.
const NOW = new Date(2026, 10, 18, 15, 0).getTime()
const at = (month: number, day: number, hour = 12): string =>
  new Date(2026, month, day, hour).toISOString()

describe('date headings', () => {
  it('sorts times into today, yesterday, this and last week, this and last month, older', () => {
    expect(dateBucket(at(10, 18, 1), NOW)).toBe('today')
    expect(dateBucket(at(10, 17, 23), NOW)).toBe('yesterday')
    // The week starts on Monday 16 November.
    expect(dateBucket(at(10, 16, 9), NOW)).toBe('thisWeek')
    expect(dateBucket(at(10, 15), NOW)).toBe('lastWeek')
    expect(dateBucket(at(10, 9), NOW)).toBe('lastWeek')
    expect(dateBucket(at(10, 8), NOW)).toBe('thisMonth')
    expect(dateBucket(at(9, 1), NOW)).toBe('lastMonth')
    expect(dateBucket(at(8, 30), NOW)).toBe('older')
  })

  it('lets yesterday win over last week on a Monday', () => {
    const monday = new Date(2026, 10, 16, 10).getTime()
    expect(dateBucket(at(10, 15), monday)).toBe('yesterday')
    expect(dateBucket(at(10, 14), monday)).toBe('lastWeek')
  })
})

describe('durations', () => {
  it('uses the two largest units', () => {
    expect(duration(45)).toBe('45 m')
    expect(duration(125)).toBe('2 h 5 m')
    expect(duration(3 * 1440 + 240)).toBe('3 d 4 h')
  })
})
