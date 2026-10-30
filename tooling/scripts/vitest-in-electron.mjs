// Runs Vitest inside Electron's own Node runtime (ELECTRON_RUN_AS_NODE), for code that depends
// on what Electron bundles, such as node:sqlite. Usage, from a workspace: node <this> [vitest args]
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// Resolve electron as the desktop app does, so the version matches what ships.
const fromDesktop = createRequire(join(root, 'apps', 'desktop', 'package.json'))
const electronPath = fromDesktop('electron')
const vitestEntry = join(
  dirname(createRequire(join(process.cwd(), 'package.json')).resolve('vitest/package.json')),
  'vitest.mjs'
)

const result = spawnSync(electronPath, [vitestEntry, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(result.status ?? 1)
