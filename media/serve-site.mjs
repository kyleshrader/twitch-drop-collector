// Serves site/ locally for a preview: `node media/serve-site.mjs [port]`.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../site/', import.meta.url))
const port = Number(process.argv[2] ?? 4321)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain'
}

// Local previews of build products (git-ignored), such as the trailer music sampler.
const previews = fileURLToPath(new URL('trailer/out/', import.meta.url))

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  const preview = path.startsWith('/_preview/')
  const base = preview ? previews : root
  let file = normalize(join(base, preview ? path.slice('/_preview/'.length) : path))
  if (!file.startsWith(normalize(base))) return res.writeHead(403).end()
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) return res.writeHead(404).end('not found')
  const size = statSync(file).size
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  // Ranges, so the video can seek.
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = Number(range[1] || 0)
    const end = range[2] ? Number(range[2]) : size - 1
    res.writeHead(206, {
      'content-type': type,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1
    })
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`site on http://127.0.0.1:${port}`))
