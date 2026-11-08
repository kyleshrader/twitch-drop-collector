// Placeholder art: two hues from a game's name, so each game's placeholder looks its own.
import type { CSSProperties } from 'react'

export function huesOf(name: string): CSSProperties {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return { '--h1': hash % 360, '--h2': (hash >> 9) % 360 } as CSSProperties
}
