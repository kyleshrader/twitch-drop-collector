// Smoke test for the packaged app in dist/ (run `yarn build:unpack` first):
// 1. the fuses are set as electron-builder.yml asks;
// 2. the app starts on a fresh profile, migrates its database, and its main window gets ready
//    with no errors logged;
// 3. on Windows and macOS, a tampered app.asar is refused (asar integrity).
// Windows stay invisible (TDC_E2E_INVISIBLE), and the profile is a temporary folder.
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(desktop, 'dist')

/** The unpacked app's executable and its app.asar, per platform. */
function locate(base) {
  if (process.platform === 'win32') {
    const dir = join(base, 'win-unpacked')
    return {
      root: dir,
      exe: join(dir, 'twitch-drop-collector.exe'),
      asar: join(dir, 'resources', 'app.asar')
    }
  }
  if (process.platform === 'darwin') {
    const dir = readdirSync(base).find((name) => name.startsWith('mac'))
    if (!dir) throw new Error('No mac build in dist/')
    const app = join(base, dir, 'Twitch Drop Collector.app')
    return {
      root: join(base, dir),
      exe: join(app, 'Contents', 'MacOS', 'Twitch Drop Collector'),
      asar: join(app, 'Contents', 'Resources', 'app.asar')
    }
  }
  const dir = join(base, 'linux-unpacked')
  return {
    root: dir,
    exe: join(dir, 'twitch-drop-collector'),
    asar: join(dir, 'resources', 'app.asar')
  }
}

const EXPECTED_FUSES = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
}

async function checkFuses(exe) {
  const wire = await getCurrentFuseWire(exe)
  const wrong = Object.entries(EXPECTED_FUSES).filter(
    ([option, enabled]) => (wire[option] === 49) !== enabled // '1' is on, '0' is off
  )
  if (wrong.length > 0) {
    throw new Error(`Fuses not as configured: ${wrong.map(([o]) => FuseV1Options[o]).join(', ')}`)
  }
  console.log('ok  fuses are set')
}

function stop(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill('SIGKILL')
}

/** Starts the app on a fresh profile; resolves with its log once `until` holds or it exits. */
async function run(exe, { until, timeoutMs = 45_000 }) {
  const profile = mkdtempSync(join(tmpdir(), 'tdc-packaged-'))
  const log = join(profile, 'logs', 'main.log')
  const env = { ...process.env, TDC_E2E_INVISIBLE: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(exe, [`--user-data-dir=${profile}`], { env, stdio: 'ignore' })
  const started = Date.now()
  const read = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  try {
    while (Date.now() - started < timeoutMs) {
      if (until(read())) return { log: read(), exited: false }
      if (child.exitCode !== null) return { log: read(), exited: true, code: child.exitCode }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return { log: read(), exited: false, timedOut: true }
  } finally {
    stop(child)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

async function checkStarts(exe) {
  const result = await run(exe, { until: (log) => log.includes('Main window ready') })
  if (!result.log.includes('Main window ready')) {
    throw new Error(`The main window never got ready (exit code ${result.code}).\n${result.log}`)
  }
  if (!result.log.includes('Database migrated')) throw new Error('The database was not migrated')
  const errors = result.log.split('\n').filter((line) => line.includes('[error]'))
  if (errors.length > 0) throw new Error(`Errors were logged:\n${errors.join('\n')}`)
  console.log('ok  starts, migrates its database and shows its main window')
}

async function checkTamperedAsarRefused(found) {
  if (process.platform === 'linux') {
    console.log('--  asar integrity is not supported on Linux; skipped')
    return
  }
  const copy = mkdtempSync(join(tmpdir(), 'tdc-tampered-'))
  try {
    cpSync(found.root, copy, { recursive: true, verbatimSymlinks: true })
    const asar = join(copy, relative(found.root, found.asar))
    const exe = join(copy, relative(found.root, found.exe))
    // Flip one byte near the end of the archive, inside a file's contents.
    const fd = openSync(asar, 'r+')
    const position = statSync(asar).size - 64
    const byte = Buffer.alloc(1)
    readSync(fd, byte, 0, 1, position)
    byte[0] ^= 0xff
    writeSync(fd, byte, 0, 1, position)
    closeSync(fd)

    // A cold start on a CI runner can be slow, so allow as long as a normal start.
    const result = await run(exe, { until: (log) => log.includes('Main window ready') })
    if (result.log.includes('Main window ready')) throw new Error('A tampered app.asar was loaded')
    if (!result.exited) {
      throw new Error(
        `The app neither loaded nor refused a tampered app.asar within 45 s.\n${result.log}`
      )
    }
    console.log(`ok  a tampered app.asar is refused (exit code ${result.code})`)
  } finally {
    rmSync(copy, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

const found = locate(dist)
if (!existsSync(found.exe)) {
  console.error(`No packaged app at ${found.exe}; run yarn build:unpack first.`)
  process.exit(1)
}
try {
  await checkFuses(found.exe)
  await checkStarts(found.exe)
  await checkTamperedAsarRefused(found)
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
