// The small slice of SQLite the rest of storage uses, so the engine stays swappable.
// Today it's Node's built-in node:sqlite (no native module); see docs/decisions.md.
import { DatabaseSync, type StatementSync } from 'node:sqlite'

export type SqlValue = null | number | bigint | string | Uint8Array
export type Row = Record<string, SqlValue>

export interface Database {
  exec(sql: string): void
  run(sql: string, ...params: SqlValue[]): { changes: number }
  get(sql: string, ...params: SqlValue[]): Row | undefined
  all(sql: string, ...params: SqlValue[]): Row[]
  /** Runs fn in a transaction; commits if it returns, rolls back if it throws. */
  transaction<T>(fn: () => T): T
  close(): void
}

export function openSqlite(file: string): Database {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 })
  try {
    // The first statement is where a corrupt file fails ("file is not a database").
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  } catch (error) {
    // Close before rethrowing: Windows can't move a file aside while a handle is open.
    db.close()
    throw error
  }

  // Statements are compiled once and reused.
  const statements = new Map<string, StatementSync>()
  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql)
    if (!statement) {
      statement = db.prepare(sql)
      statements.set(sql, statement)
    }
    return statement
  }

  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...params) => ({ changes: Number(prepare(sql).run(...params).changes) }),
    get: (sql, ...params) => prepare(sql).get(...params) as Row | undefined,
    all: (sql, ...params) => prepare(sql).all(...params) as Row[],
    transaction: <T>(fn: () => T): T => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK')
        throw error
      }
    },
    close: (): void => {
      statements.clear()
      db.close()
    }
  }
}
