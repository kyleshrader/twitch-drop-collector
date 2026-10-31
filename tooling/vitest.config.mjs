// Shared Vitest config; each workspace's test script passes it with --config. On GitHub Actions
// each run writes its job summary to test-reports/, titled with the package name, and
// tooling/scripts/test-report.mjs puts them together under one heading per OS.
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { name } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
// tooling/scripts/vitest-in-electron.mjs runs Vitest on Electron's Node.
const electron = process.versions.electron !== undefined
const title = electron ? `${name} (Electron)` : name
const file = `${name.replace(/^@/, '').replace(/\//g, '-')}${electron ? '-electron' : ''}.md`

const onGitHub = process.env.GITHUB_ACTIONS === 'true'
// The reporter appends to its file but doesn't create the folder.
if (onGitHub) mkdirSync(join(root, 'test-reports'), { recursive: true })

export default defineConfig({
  test: onGitHub
    ? {
        reporters: [
          'default',
          [
            'github-actions',
            { jobSummary: { title, outputPath: join(root, 'test-reports', file) } }
          ]
        ]
      }
    : {}
})
