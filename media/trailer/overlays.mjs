// Renders the trailer's graphics to PNG from HTML (in an offscreen Electron window, so they use
// the app's own font, Inter, and colours): the background, the window's mask and edge, each
// scene's header band and caption bar, the accent bars, and the title and end cards.
//
//   node media/trailer/overlays.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { APP_SCENES, FRAME, MUSIC, WINDOW } from './scenes.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '..', '..')
const out = join(here, 'out', 'overlays')
const htmlDir = join(out, 'html')
mkdirSync(htmlDir, { recursive: true })

const require = createRequire(join(root, 'e2e', 'package.json'))
const electron = require('electron')
const font = pathToFileURL(
  join(
    root,
    'node_modules',
    '@fontsource-variable',
    'inter',
    'files',
    'inter-latin-wght-normal.woff2'
  )
).href
const logo = readFileSync(join(root, 'apps', 'desktop', 'build', 'icon.svg'), 'utf8')

export const COLOURS = {
  bg: '#0a0d11',
  text: '#eef2f6',
  muted: '#9aa7b6',
  faint: '#5f6c7d',
  accent: '#4d9be6',
  violet: '#6a4fd8'
}

const page = (body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url('${font}') format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; width: 100%; height: 100%; overflow: hidden; }
body { font-family: Inter, sans-serif; color: ${COLOURS.text}; -webkit-font-smoothing: antialiased; }
${css}
</style></head><body>${body}</body></html>`

const jobs = []
function job(name, html, width = FRAME.width, height = FRAME.height) {
  const file = join(htmlDir, `${name}.html`)
  writeFileSync(file, html)
  jobs.push({ html: file, out: join(out, `${name}.png`), width, height })
}

const { x, y, width, height } = WINDOW

// The stage: deep blue-black, a glow behind the window, a faint grid, and the window's shadow.
job(
  'background',
  page(
    `<div class="glow a"></div><div class="glow b"></div><div class="grid"></div><div class="plate"></div>`,
    `body { background: ${COLOURS.bg}; }
.glow { position: absolute; border-radius: 50%; filter: blur(120px); }
.a { left: 420px; top: 260px; width: 1100px; height: 640px; background: rgba(77,155,230,.22); }
.b { left: 1150px; top: 520px; width: 700px; height: 480px; background: rgba(106,79,216,.20); }
.grid { position: absolute; inset: 0; opacity: .5;
  background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
  background-size: 48px 48px; mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%); }
.plate { position: absolute; left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px;
  border-radius: 14px; background: #1a1e25;
  box-shadow: 0 40px 120px rgba(0,0,0,.7), 0 10px 30px rgba(0,0,0,.5); }`
  )
)

// The window's rounded corners (a mask for the recording) and its fine edge highlight.
job(
  'mask',
  page(
    `<div></div>`,
    `body { background: #000; } div { position: absolute; inset: 0; border-radius: 14px; background: #fff; }`
  ),
  width,
  height
)
job(
  'edge',
  page(
    `<div></div>`,
    `div { position: absolute; left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px; border-radius: 14px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.09), 0 0 0 1px rgba(0,0,0,.6); }`
  )
)

// Each scene's header band (top 150 px) and caption bar (bottom 120 px).
const total = APP_SCENES.length
APP_SCENES.forEach((scene, i) => {
  const number = `${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
  job(
    `header-${scene.id}`,
    page(
      `<div class="bar"></div><h1>${scene.header}</h1>${scene.sub ? `<p>${scene.sub}</p>` : ''}<span>${number}</span>`,
      `.bar { position: absolute; left: ${x - 28}px; top: 40px; width: 6px; height: ${scene.sub ? 80 : 56}px; border-radius: 3px;
  background: linear-gradient(${COLOURS.accent}, ${COLOURS.violet}); box-shadow: 0 0 18px rgba(77,155,230,.6); }
h1 { position: absolute; left: ${x}px; top: ${scene.sub ? 30 : 40}px; font-size: 52px; font-weight: 750; letter-spacing: -.02em; }
p { position: absolute; left: ${x + 2}px; top: 96px; font-size: 24px; color: ${COLOURS.muted}; font-weight: 450; }
span { position: absolute; right: ${FRAME.width - x - width}px; top: 50px; font-size: 20px; font-weight: 600;
  color: ${COLOURS.faint}; letter-spacing: .12em; font-variant-numeric: tabular-nums; }`
    ),
    FRAME.width,
    150
  )
  if (scene.caption) {
    job(
      `caption-${scene.id}`,
      page(
        `<div class="pill"><i></i>${scene.caption}</div>`,
        `.pill { position: absolute; left: ${x}px; top: 34px; height: 52px; display: flex; align-items: center; gap: 16px;
  padding: 0 26px 0 0; border-radius: 10px; background: rgba(20,25,32,.88); border: 1px solid rgba(255,255,255,.08);
  font-size: 23px; font-weight: 520; color: ${COLOURS.text}; overflow: hidden;
  box-shadow: 0 12px 30px rgba(0,0,0,.45); }
i { display: block; width: 8px; align-self: stretch; background: linear-gradient(${COLOURS.accent}, ${COLOURS.violet}); }`
      ),
      FRAME.width,
      120
    )
  }
})

// The music credit, bottom right, level with the caption bar (MUSIC in scenes.mjs).
job(
  'music',
  page(
    `<div class="credit"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M9 18V5l12-2v13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg><div><b>${MUSIC.title}</b> · ${MUSIC.artist}<small>${MUSIC.licence} · ${MUSIC.source}</small></div></div>`,
    `.credit { position: absolute; right: ${FRAME.width - x - width}px; top: 34px; height: 52px; display: flex; align-items: center; gap: 12px;
  padding: 0 18px; border-radius: 10px; background: rgba(20,25,32,.72); border: 1px solid rgba(255,255,255,.07);
  color: ${COLOURS.muted}; font-size: 17px; line-height: 1.25; }
.credit svg { color: ${COLOURS.accent}; flex: none; }
.credit b { color: ${COLOURS.text}; font-weight: 650; }
.credit small { display: block; font-size: 13px; color: ${COLOURS.faint}; }`
  ),
  FRAME.width,
  120
)

// Accent bars that sweep across at a cut.
job(
  'accent',
  page(
    `<i class="one"></i><i class="two"></i><i class="three"></i>`,
    `i { position: absolute; height: 4px; border-radius: 2px; }
.one { left: 0; top: 0; width: 520px; background: linear-gradient(90deg, transparent, ${COLOURS.accent}); }
.two { left: 140px; top: 12px; width: 300px; background: linear-gradient(90deg, transparent, ${COLOURS.violet}); }
.three { left: 380px; top: 24px; width: 140px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.7)); }`
  ),
  520,
  28
)

// The title and end cards (over the background, without the window plate).
const card = (title, sub, extra = '') =>
  page(
    `<div class="wrap"><div class="logo">${logo}</div><h1>${title}</h1><p>${sub}</p>${extra}</div>`,
    `.wrap { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
.logo svg { width: 150px; height: 150px; filter: drop-shadow(0 18px 40px rgba(77,155,230,.45)); }
h1 { font-size: 84px; font-weight: 800; letter-spacing: -.035em; margin-top: 14px; }
p { font-size: 30px; color: ${COLOURS.muted}; font-weight: 450; }
.url { margin-top: 26px; padding: 14px 26px; border-radius: 12px; font-size: 26px; font-weight: 600;
  background: rgba(77,155,230,.14); border: 1px solid rgba(77,155,230,.4); color: #cfe3fb; }`
  )
job(
  'title',
  card('Twitch Drop Collector', 'Your Twitch drops, collected while you get on with your day.')
)
job(
  'end',
  card(
    'Twitch Drop Collector',
    'Free and open source · Windows, macOS and Linux',
    '<div class="url">github.com/kyleshrader/twitch-drop-collector</div>'
  )
)
// A plain background for the cards (no window plate).
job(
  'card-background',
  page(
    `<div class="glow a"></div><div class="glow b"></div>`,
    `body { background: ${COLOURS.bg}; }
.glow { position: absolute; border-radius: 50%; filter: blur(140px); }
.a { left: 360px; top: 200px; width: 900px; height: 600px; background: rgba(77,155,230,.20); }
.b { left: 900px; top: 420px; width: 700px; height: 500px; background: rgba(106,79,216,.20); }`
  )
)

const jobsFile = join(out, 'jobs.json')
writeFileSync(jobsFile, JSON.stringify(jobs))
execFileSync(electron, [join(here, 'render.cjs'), jobsFile], { stdio: 'inherit' })
console.log(`${jobs.length} overlays in ${out}`)
