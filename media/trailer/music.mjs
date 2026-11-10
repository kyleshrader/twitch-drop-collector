// Downloads the trailer's music (MUSIC in scenes.mjs: CC0, so it can be used freely) into
// out/music/, once. It isn't kept in the repository.
//
//   node media/trailer/music.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUSIC } from './scenes.mjs'

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'out', 'music')
const file = join(dir, MUSIC.local)
if (existsSync(file)) {
  console.log(`${file}: already here`)
} else {
  mkdirSync(dir, { recursive: true })
  const response = await fetch(MUSIC.file)
  if (!response.ok) throw new Error(`${MUSIC.file}: HTTP ${response.status}`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  console.log(`${file}: ${MUSIC.title} by ${MUSIC.artist} (${MUSIC.licence}), from ${MUSIC.page}`)
}
