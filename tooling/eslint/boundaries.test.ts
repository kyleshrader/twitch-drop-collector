// Proves the dependency rules in boundaries.mjs fire, by linting imports from fake files
// placed in each element. Allowed cases guard against a config that rejects everything.
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const eslint = new ESLint({ cwd: root })

async function boundaryErrors(file: string, specifier: string): Promise<string[]> {
  const [result] = await eslint.lintText(`import '${specifier}'\n`, { filePath: `${root}/${file}` })
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'boundaries/dependencies')
    .map((m) => m.message)
}

const CORE = 'packages/core/src/probe.ts'
const API = 'packages/api/src/probe.ts'
const CONFIG = 'packages/config/src/probe.ts'
const IPC = 'packages/ipc-contract/src/probe.ts'
const UI = 'packages/ui/src/probe.tsx'
const MAIN = 'apps/desktop/src/main/probe.ts'
const PRELOAD = 'apps/desktop/src/preload/probe.ts'
const RENDERER = 'apps/desktop/src/renderer/src/probe.tsx'

describe('forbidden imports fail lint', () => {
  it.each([
    ['rule 1: core imports electron', CORE, 'electron'],
    ['rule 1: config imports react', CONFIG, 'react'],
    ['rule 2: api imports core', API, '@tdc/core'],
    ['rule 2: api imports storage', API, '@tdc/storage'],
    ['rule 3: ui imports electron', UI, 'electron'],
    ['rule 3: ui imports core', UI, '@tdc/core'],
    ['rule 4: renderer imports core', RENDERER, '@tdc/core'],
    ['rule 4: renderer imports electron', RENDERER, 'electron'],
    ['rule 4: renderer imports a Node built-in', RENDERER, 'node:fs'],
    ['rule 5: preload imports zod', PRELOAD, 'zod'],
    ['rule 5: preload imports core', PRELOAD, '@tdc/core'],
    ['rule 6: main imports ui', MAIN, '@tdc/ui'],
    ['rule 7: ipc-contract imports react', IPC, 'react'],
    ['rule 7: ipc-contract imports core', IPC, '@tdc/core']
  ])('%s', async (_name, file, specifier) => {
    expect(await boundaryErrors(file, specifier)).not.toEqual([])
  })
})

describe('allowed imports pass lint', () => {
  it.each([
    ['core imports api', CORE, '@tdc/api'],
    ['core imports a Node built-in', CORE, 'node:path'],
    ['ui imports react', UI, 'react'],
    ['renderer imports ui', RENDERER, '@tdc/ui'],
    ['renderer imports ipc-contract', RENDERER, '@tdc/ipc-contract'],
    ['preload imports electron', PRELOAD, 'electron'],
    ['preload imports ipc-contract', PRELOAD, '@tdc/ipc-contract'],
    ['main imports core', MAIN, '@tdc/core'],
    ['main imports electron', MAIN, 'electron'],
    ['ipc-contract imports zod', IPC, 'zod']
  ])('%s', async (_name, file, specifier) => {
    expect(await boundaryErrors(file, specifier)).toEqual([])
  })
})
