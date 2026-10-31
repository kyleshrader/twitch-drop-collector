// Puts the per-package Vitest summaries in test-reports/ together under one heading and appends
// them to the GitHub job summary. Usage: node <this> <heading>
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = join(root, 'test-reports')
const heading = process.argv[2] ?? 'Test Report'
const names = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -'.md'.length))
      .sort()
  : []
// Each section repeats Vitest's "### Summary" line under the package heading; drop it.
const sections = names.map((n) =>
  readFileSync(join(dir, `${n}.md`), 'utf8')
    .replace(/^### Summary\n\n?/m, '')
    .trimEnd()
)
const report = `# ${heading}\n\n${sections.length > 0 ? sections.join('\n\n') : 'No test results were written.'}\n`

const output = process.env['GITHUB_STEP_SUMMARY']
if (output) appendFileSync(output, report)
else process.stdout.write(report)
