// Makes a Twitch response safe to save, show and paste into a public GitHub issue: no tokens or
// signatures, no drop instance IDs (they carry the user's ID), and the signed-in user's ID and
// login replaced wherever they appear. Also trims it to a readable size.

/** Keys whose values are never kept, matched case-insensitively. */
const SECRET_KEY = /token|signature|authoriz|password|secret|cookie|email|instance_?id|^value$/i

export const REDACTED = '[redacted]'
export const YOU = '<you>'

const MAX_STRING = 500
const MAX_ITEMS = 25
const MAX_DEPTH = 14

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * `identities()`: the signed-in user's ID and login, asked on every call. Values equal to or
 * containing one of them have it replaced with <you>.
 */
export function createRedactor(identities: () => readonly string[]): (value: unknown) => unknown {
  return (value) => {
    const known = identities().filter((s) => s.length >= 3)
    const pattern = known.length ? new RegExp(known.map(escape).join('|'), 'gi') : undefined
    const text = (s: string): string => {
      const replaced = pattern ? s.replace(pattern, YOU) : s
      return replaced.length > MAX_STRING
        ? `${replaced.slice(0, MAX_STRING)}… (${replaced.length - MAX_STRING} more characters)`
        : replaced
    }
    const walk = (node: unknown, depth: number): unknown => {
      if (typeof node === 'string') return text(node)
      if (typeof node === 'number' && pattern && known.includes(String(node))) return YOU
      if (node === null || typeof node !== 'object') return node
      if (depth >= MAX_DEPTH) return '…'
      if (Array.isArray(node)) {
        const items = node.slice(0, MAX_ITEMS).map((item) => walk(item, depth + 1))
        if (node.length > MAX_ITEMS) items.push(`… ${node.length - MAX_ITEMS} more`)
        return items
      }
      const out: Record<string, unknown> = {}
      for (const [key, inner] of Object.entries(node)) {
        out[text(key)] = SECRET_KEY.test(key) && inner !== null ? REDACTED : walk(inner, depth + 1)
      }
      return out
    }
    return walk(value, 0)
  }
}
