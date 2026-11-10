// The trailer's stage: the app with the demo data and the mock Twitch, a visible cursor (a
// recording has none), smooth mouse moves, and frame capture through Chromium's screencast.
import type { CDPSession, ElectronApplication, Locator, Page } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, twitchEndpoints } from '../tests/app'
import { startMockTwitch, type MockTwitch } from '../tests/mock-twitch'

export const TRAILER = fileURLToPath(new URL('../../media/trailer/', import.meta.url))
export const DEMO_DATA = join(TRAILER, 'out', 'userdata')
/** The app's size in the trailer and on the site: 16:9, the frame's middle. */
export const SIZE = { width: 1440, height: 810 }

export interface Stage {
  app: ElectronApplication
  page: Page
  twitch: MockTwitch
  close(): Promise<void>
}

export async function openStage(options: { theme?: 'dark' | 'light' } = {}): Promise<Stage> {
  const twitch = await startMockTwitch()
  twitch.login = 'demo_viewer'
  // A fresh copy each time, so a run never changes the demo data.
  const userDataDir = mkdtempSync(join(tmpdir(), 'tdc-trailer-'))
  cpSync(DEMO_DATA, userDataDir, { recursive: true })
  const { app, window: page } = await launchApp(userDataDir, {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  await app.evaluate(({ BrowserWindow, shell }, size) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setContentSize(size.width, size.height)
    // Report on GitHub and channel links would open the browser; not on the stage.
    shell.openExternal = async () => {}
  }, SIZE)
  if (options.theme === 'light') {
    await page.evaluate(() =>
      (
        window as unknown as { api: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).api.invoke('settings:update', { general: { theme: 'light' } })
    )
  }
  await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
  await page
    .getByRole('region', { name: 'Current' })
    .getByText('Black Desert')
    .first()
    .waitFor({ timeout: 30_000 })
  // Box art loads from Twitch's image servers into the app's cache; fetch it all once now, so
  // the scenes never show the letter placeholders.
  await page.evaluate(() => (location.hash = '#/library'))
  await page.waitForTimeout(1500)
  // Covers load lazily: scroll every scrolling area through once.
  await page.evaluate(async () => {
    const areas = [...document.querySelectorAll<HTMLElement>('*')].filter(
      (el) => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible'
    )
    for (const el of areas) {
      for (let y = 0; y <= el.scrollHeight; y += 300) {
        el.scrollTop = y
        await new Promise((r) => setTimeout(r, 120))
      }
      el.scrollTop = 0
    }
  })
  await page.waitForTimeout(2500)
  await page.evaluate(() => (location.hash = '#/history'))
  await page.waitForTimeout(1500)
  await page.evaluate(() => (location.hash = '#/drops'))
  await page.waitForTimeout(800)
  await showCursor(page)
  return {
    app,
    page,
    twitch,
    close: async () => {
      await app.close()
      await twitch.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  }
}

/** A soft white cursor with a ring on clicks; a page recording doesn't show the real one. */
export async function showCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('stage-cursor')) return
    const cursor = document.createElement('div')
    cursor.id = 'stage-cursor'
    cursor.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.5-3.5 6.5z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    Object.assign(cursor.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      transform: 'translate(-200px, -200px)',
      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.45))'
    })
    document.body.append(cursor)
    document.addEventListener(
      'mousemove',
      (e) => (cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`),
      true
    )
    document.addEventListener(
      'mousedown',
      (e) => {
        const ring = document.createElement('div')
        Object.assign(ring.style, {
          position: 'fixed',
          left: `${e.clientX - 18}px`,
          top: `${e.clientY - 18}px`,
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          border: '2px solid rgba(120,170,255,.9)',
          zIndex: '2147483646',
          pointerEvents: 'none',
          transition: 'transform .45s ease-out, opacity .45s ease-out'
        })
        document.body.append(ring)
        requestAnimationFrame(() => {
          ring.style.transform = 'scale(1.8)'
          ring.style.opacity = '0'
        })
        setTimeout(() => ring.remove(), 500)
      },
      true
    )
  })
}

let cursorAt = { x: SIZE.width / 2, y: SIZE.height / 2 }

/** Glides the mouse to the middle of `target` (or a point), at a pace a viewer can follow. */
export async function glide(
  page: Page,
  target: Locator | { x: number; y: number },
  ms = 650
): Promise<void> {
  let to: { x: number; y: number }
  if ('x' in target) {
    to = target
  } else {
    await target.scrollIntoViewIfNeeded()
    const box = (await target.boundingBox())!
    to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const steps = Math.max(8, Math.round(ms / 16))
  const from = cursorAt
  for (let i = 1; i <= steps; i++) {
    // Ease in and out.
    const t = i / steps
    const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)
    await page.waitForTimeout(ms / steps)
  }
  cursorAt = to
}

export async function press(page: Page, target: Locator, ms?: number): Promise<void> {
  await glide(page, target, ms)
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.mouse.up()
}

export const hold = (page: Page, ms: number): Promise<void> => page.waitForTimeout(ms)

/** Smooth scroll of the page's scrolling area by `dy`, over `ms`. */
export async function scrollBy(page: Page, dy: number, ms = 900): Promise<void> {
  const steps = Math.round(ms / 16)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps)
    await page.waitForTimeout(16)
  }
}

/**
 * Records a scene: every frame the window paints while `act` runs, with its time, written to
 * out/scenes/<name>/ as JPEGs and an ffmpeg concat list with each frame's duration.
 */
export async function record(stage: Stage, name: string, act: () => Promise<void>): Promise<void> {
  const dir = join(TRAILER, 'out', 'scenes', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const cdp: CDPSession = await stage.page.context().newCDPSession(stage.page)
  const frames: { file: string; at: number }[] = []
  cdp.on('Page.screencastFrame', (frame) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`
    writeFileSync(join(dir, file), Buffer.from(frame.data, 'base64'))
    frames.push({ file, at: frame.metadata.timestamp ?? Date.now() / 1000 })
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 94,
    maxWidth: SIZE.width,
    maxHeight: SIZE.height,
    everyNthFrame: 1
  })
  const started = Date.now() / 1000
  await act()
  // A last frame, so the clip runs to the end of the action even if nothing moved.
  await stage.page.waitForTimeout(150)
  const ended = Date.now() / 1000
  await cdp.send('Page.stopScreencast')
  await cdp.detach()
  if (frames.length === 0) throw new Error(`no frames for ${name}`)
  const times = frames.map((f) => f.at)
  const list = frames
    .map((f, i) => {
      const next = times[i + 1] ?? Math.max(ended, f.at + 1 / 30)
      return `file '${f.file}'\nduration ${Math.max(1 / 120, next - f.at).toFixed(4)}`
    })
    .join('\n')
  // The concat demuxer needs the last file repeated to honour its duration.
  writeFileSync(join(dir, 'frames.txt'), `${list}\nfile '${frames.at(-1)!.file}'\n`)
  writeFileSync(
    join(dir, 'scene.json'),
    JSON.stringify({ frames: frames.length, seconds: ended - started }, null, 2)
  )
}
