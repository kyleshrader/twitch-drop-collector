// Times and durations as the new UI writes them: "3 d 4 h", "2 h 5 m", "45 m".
const MINUTE = 60_000

/** A duration in minutes, to the two largest units. */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} m`
  const days = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  const rest = m % 60
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`
  return rest > 0 ? `${hours} h ${rest} m` : `${hours} h`
}

/** Minutes from `now` until an ISO time (negative once it's past). */
export const minutesUntil = (iso: string, now: number): number => (Date.parse(iso) - now) / MINUTE

const FULL = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})
const SHORT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

/** "Saturday 7 November 2026, 10:00", for tooltips. */
export const fullDate = (iso: string): string => FULL.format(new Date(iso))
/** "7 Nov". */
export const shortDate = (iso: string): string => SHORT.format(new Date(iso))

/** Date headings for lists sorted by time, newest first. Weeks start on Monday. */
export type DateBucket =
  'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'older'

export const DATE_BUCKETS: readonly DateBucket[] = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'older'
]

const DAY = 24 * 60 * MINUTE

export function dateBucket(iso: string, now: number): DateBucket {
  const at = Date.parse(iso)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const startOfToday = today.getTime()
  if (at >= startOfToday) return 'today'
  if (at >= startOfToday - DAY) return 'yesterday'
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  if (at >= weekStart.getTime()) return 'thisWeek'
  const lastWeekStart = new Date(weekStart)
  lastWeekStart.setDate(weekStart.getDate() - 7)
  if (at >= lastWeekStart.getTime()) return 'lastWeek'
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  if (at >= monthStart.getTime()) return 'thisMonth'
  if (at >= new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime()) return 'lastMonth'
  return 'older'
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** "Today, 13:42", "Yesterday, 22:05", or "4 Nov, 17:30". */
export function whenLabel(iso: string, now: number): string {
  const bucket = dateBucket(iso, now)
  const time = TIME.format(new Date(iso))
  if (bucket === 'today') return `Today, ${time}`
  if (bucket === 'yesterday') return `Yesterday, ${time}`
  return `${shortDate(iso)}, ${time}`
}
