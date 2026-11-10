// Things that happened in the app, for the History page: a game put on a list, an account
// linked, mining paused or resumed, the app version it ran. Each has a kind and a little data.
import type { Database } from './database'

export interface AppEvent {
  id: number
  kind: string
  at: Date
  data: Record<string, unknown>
}

export interface EventLog {
  record(kind: string, data: Record<string, unknown>, at: Date): void
  /** Oldest first. */
  all(): AppEvent[]
  /** The newest event of a kind. */
  latest(kind: string): AppEvent | undefined
}

export function createEventLog(deps: { db: Database }): EventLog {
  const { db } = deps
  const toEvent = (row: Record<string, unknown>): AppEvent => {
    let data: unknown
    try {
      data = JSON.parse(String(row['data']))
    } catch {
      data = {}
    }
    return {
      id: Number(row['id']),
      kind: String(row['kind']),
      at: new Date(Number(row['at'])),
      data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
    }
  }
  return {
    record(kind, data, at): void {
      db.run(
        'INSERT INTO events (kind, at, data) VALUES (?, ?, ?)',
        kind,
        at.getTime(),
        JSON.stringify(data)
      )
    },
    all(): AppEvent[] {
      return db.all('SELECT * FROM events ORDER BY at, id').map(toEvent)
    },
    latest(kind): AppEvent | undefined {
      const row = db.get(
        'SELECT * FROM events WHERE kind = ? ORDER BY at DESC, id DESC LIMIT 1',
        kind
      )
      return row ? toEvent(row) : undefined
    }
  }
}
