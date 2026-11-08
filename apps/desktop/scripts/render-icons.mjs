// Draws the app icon and writes every file that uses it:
//   build/icon.svg               the source, for reference
//   build/icon.png (1024)        electron-builder's Linux icon
//   build/icon.ico               Windows (16 to 256 px)
//   build/icon.icns              macOS (16 to 1024 px)
//   resources/icon.png (512)     the window and tray icon at run time
// Run with Electron, which rasterises the SVG: yarn workspace @tdc/desktop icons
//
// The glyph is the new UI's brand icon (lucide's pickaxe, `brand` in src/renderer/src/next/
// icons.ts), read from lucide's own icon data so the two can't drift apart.
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lucide = dirname(createRequire(import.meta.url).resolve('lucide-react/package.json'))
const { __iconData: pickaxe } = await import(
  pathToFileURL(join(lucide, 'dist/esm/icons/pickaxe.mjs')).href
)

const attrs = (props) =>
  Object.entries(props)
    .filter(([name]) => name !== 'key')
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ')
const GLYPH = pickaxe.node.map(([tag, props]) => `<${tag} ${attrs(props)}/>`).join('')

/** The icon: the glyph in white on the brand's blue-to-purple tile. Small sizes get a bigger,
 * bolder glyph so it stays readable in the tray and taskbar. */
function iconSvg(small) {
  const size = 1024
  const margin = small ? 96 : 152
  const scale = (size - 2 * margin) / 24
  const stroke = small ? 2.6 : 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4d9be6"/>
      <stop offset="1" stop-color="#6a4fd8"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${small ? 200 : 224}" fill="url(#tile)"/>
  <g transform="translate(${margin} ${margin}) scale(${scale})" fill="none" stroke="#fff"
     stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${GLYPH}
  </g>
</svg>
`
}

const SMALL = 48
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

/** Rasterises in a hidden window's canvas; returns PNG bytes by size. */
async function render() {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await window.loadURL('about:blank')
  const sources = { small: iconSvg(true), large: iconSvg(false) }
  const pngs = await window.webContents.executeJavaScript(`(async () => {
    const sources = ${JSON.stringify(sources)}
    const load = (svg) => new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = 'data:image/svg+xml;base64,' + btoa(svg)
    })
    const images = { small: await load(sources.small), large: await load(sources.large) }
    const out = {}
    for (const size of ${JSON.stringify(SIZES)}) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(size <= ${SMALL} ? images.small : images.large, 0, 0, size, size)
      out[size] = canvas.toDataURL('image/png').split(',')[1]
    }
    return out
  })()`)
  window.destroy()
  return new Map(
    Object.entries(pngs).map(([size, b64]) => [Number(size), Buffer.from(b64, 'base64')])
  )
}

/** ICO with PNG images (Windows Vista and later). */
function ico(pngs, sizes) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  const entries = []
  let offset = 6 + 16 * sizes.length
  for (const size of sizes) {
    const data = pngs.get(size)
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...sizes.map((s) => pngs.get(s))])
}

/** ICNS with PNG images. */
function icns(pngs) {
  const types = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024]
  ]
  const chunks = types.map(([type, size]) => {
    const data = pngs.get(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const pngs = await render()
    const write = (path, data) => {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), data)
      console.log(`wrote ${path} (${data.length} bytes)`)
    }
    write('build/icon.svg', iconSvg(false))
    write('build/icon.png', pngs.get(1024))
    write('build/icon.ico', ico(pngs, [16, 24, 32, 48, 64, 128, 256]))
    write('build/icon.icns', icns(pngs))
    write('resources/icon.png', pngs.get(512))
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
