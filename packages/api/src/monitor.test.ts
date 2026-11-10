import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { checkShape, shapeChecks, type ApiIssue } from './monitor'

const Schema = z.looseObject({
  user: z
    .looseObject({
      id: z.string(),
      drops: z.array(z.looseObject({ minutes: z.number() })).nullish()
    })
    .nullable()
})

describe('shape checks', () => {
  it('gives the expected schema and the actual value at each difference', () => {
    const value = { user: { id: 7, drops: [{ minutes: 1 }, { minutes: 'two' }] } }
    const parsed = Schema.safeParse(value)
    expect(parsed.success).toBe(false)
    const checks = shapeChecks(Schema, value, parsed.error!)
    expect(checks).toEqual([
      expect.objectContaining({ path: 'user.id', expected: { type: 'string' }, actual: 7 }),
      expect.objectContaining({
        path: 'user.drops.1.minutes',
        expected: { type: 'number' },
        actual: 'two'
      })
    ])
  })

  it('marks missing fields, and keeps whole expected objects readable', () => {
    const value = { user: {} }
    const checks = shapeChecks(Schema, value, Schema.safeParse(value).error!)
    expect(checks).toEqual([expect.objectContaining({ path: 'user.id', missing: true })])

    const nothing = {}
    const [root] = shapeChecks(Schema, nothing, Schema.safeParse(nothing).error!)
    expect(root).toMatchObject({ path: 'user', missing: true })
    // No JSON Schema bookkeeping in what's shown.
    expect(JSON.stringify(root!.expected)).not.toMatch(/additionalProperties|\$schema/)
    expect(JSON.stringify(root!.expected)).toMatch(/"id"/)
  })

  it('reports through the monitor only when the value does not match', () => {
    const issues: ApiIssue[] = []
    const monitor = { report: (issue: ApiIssue) => issues.push(issue) }
    expect(checkShape(monitor, 'pubsub', 'topic', Schema, { user: null }).success).toBe(true)
    expect(checkShape(monitor, 'pubsub', 'topic', Schema, { user: 1 }).success).toBe(false)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ source: 'pubsub', endpoint: 'topic', kind: 'shape' })
  })
})
