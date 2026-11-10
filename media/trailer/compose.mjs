// Puts the trailer together with ffmpeg (SCRIPT.md): each scene becomes a 1920 × 1080 segment (the
// recording fitted to its slot, in the rounded window, with the header, caption and accent bars
// animating in), then the segments are joined with transitions on the bar lines, over the music,
// with its credit bottom right.
// Also writes a poster frame and a short GIF for the README.
//
//   node media/trailer/compose.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BAR, CUT, FADE_OUT, FPS, FRAME, MUSIC, SCENES, WINDOW } from './scenes.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const out = join(here, 'out')
const overlays = join(out, 'overlays')
const segments = join(out, 'segments')
const site = join(here, '..', '..', 'site', 'media')
mkdirSync(segments, { recursive: true })
mkdirSync(site, { recursive: true })

const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit'
  })
const png = (name) => join(overlays, `${name}.png`)
const fmt = (n) => n.toFixed(3)
const ENCODE = [
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '17',
  '-pix_fmt',
  'yuv420p',
  '-r',
  String(FPS)
]

/** A segment's length: its bars, plus the transition into the next (the last has none). */
const lengthOf = (scene, i) =>
  (scene.bars[1] - scene.bars[0]) * BAR + (i < SCENES.length - 1 ? CUT : 0)

function card(scene, i) {
  const length = lengthOf(scene, i)
  const file = join(segments, `${i}-${scene.id}.mp4`)
  const fadeIn = scene.id === 'title' ? 1.1 : 0.8
  ffmpeg([
    '-loop',
    '1',
    '-t',
    fmt(length),
    '-i',
    png('card-background'),
    '-loop',
    '1',
    '-t',
    fmt(length),
    '-i',
    png(scene.id),
    '-filter_complex',
    [
      `[1]format=rgba,fade=in:st=${scene.id === 'title' ? 0.4 : 0.2}:d=${fadeIn}:alpha=1,`,
      // A slow push in, so the card isn't a still.
      `scale=w='${FRAME.width}*(1+0.025*t/${fmt(length)})':h=-1:eval=frame,`,
      `crop=${FRAME.width}:${FRAME.height}[c];`,
      `[0][c]overlay=0:0,format=yuv420p[v]`
    ].join(''),
    '-map',
    '[v]',
    '-t',
    fmt(length),
    ...ENCODE,
    file
  ])
  return file
}

function appScene(scene, i, number) {
  const length = lengthOf(scene, i)
  const dir = join(out, 'scenes', scene.id)
  const recorded = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')).seconds
  // Fit the recording to the slot: speed it up a little if it ran long (never above 1.6×).
  const speed = Math.min(1.6, Math.max(1, recorded / (length - 0.2)))
  const visible = length - CUT
  const textOut = Math.max(1.5, visible - 0.45)
  const crop = scene.crop
    ? `crop=${scene.crop.width}:${scene.crop.height}:${scene.crop.x}:${scene.crop.y},scale=${WINDOW.width}:${WINDOW.height}:flags=lanczos,`
    : ''
  const layers = [
    `[1]setpts=PTS/${fmt(speed)},fps=${FPS},${crop}trim=0:${fmt(length)},setpts=PTS-STARTPTS,`,
    `tpad=stop_mode=clone:stop_duration=${fmt(length)},trim=0:${fmt(length)},format=rgba[rec];`,
    `[2]format=gray[mask];[rec][mask]alphamerge[app];`,
    `[0][app]overlay=${WINDOW.x}:${WINDOW.y}:shortest=1[s1];`,
    `[s1][3]overlay=0:0[s2];`,
    // The header slides up and fades in a beat after the cut, and fades before the next one.
    `[4]format=rgba,fade=in:st=0.3:d=0.4:alpha=1,fade=out:st=${fmt(textOut)}:d=0.35:alpha=1[h];`,
    `[s2][h]overlay=x=0:y='if(lt(t,0.3),24,max(0,24-(t-0.3)/0.4*24))'[s3];`,
    // Accent bars sweep across under the header.
    `[6]format=rgba,fade=in:st=0.05:d=0.25:alpha=1,fade=out:st=1.0:d=0.4:alpha=1[a];`,
    `[s3][a]overlay=x='-520+(t-0.05)*1500':y=132:enable='between(t,0.05,1.45)'[s4]`
  ]
  let last = 's4'
  if (scene.caption) {
    layers.push(
      `;[5]format=rgba,fade=in:st=0.7:d=0.45:alpha=1,fade=out:st=${fmt(textOut)}:d=0.35:alpha=1[c];`,
      `[s4][c]overlay=x='if(lt(t,0.7),-160,min(0,-160+(t-0.7)/0.45*160))':y=${FRAME.height - 120}[s5]`
    )
    last = 's5'
  }
  layers.push(`;[${last}]format=yuv420p[v]`)
  const file = join(segments, `${i}-${scene.id}.mp4`)
  ffmpeg([
    '-loop',
    '1',
    '-t',
    fmt(length),
    '-i',
    png('background'),
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    join(dir, 'frames.txt'),
    '-loop',
    '1',
    '-t',
    fmt(length),
    '-i',
    png('mask'),
    '-loop',
    '1',
    '-t',
    fmt(length),
    '-i',
    png('edge'),
    '-loop',
    '1',
    '-t',
    fmt(length),
    '-i',
    png(`header-${scene.id}`),
    '-loop',
    '1',
    '-t',
    fmt(length),
    '-i',
    png(scene.caption ? `caption-${scene.id}` : `header-${scene.id}`),
    '-loop',
    '1',
    '-t',
    fmt(length),
    '-i',
    png('accent'),
    '-filter_complex',
    layers.join(''),
    '-map',
    '[v]',
    '-t',
    fmt(length),
    ...ENCODE,
    file
  ])
  console.log(
    `  ${scene.id}: ${recorded.toFixed(1)} s recorded, ${fmt(speed)}× into ${length.toFixed(1)} s (scene ${number})`
  )
  return file
}

console.log('segments')
let number = 0
const files = SCENES.map((scene, i) =>
  scene.kind === 'card' ? card(scene, i) : appScene(scene, i, ++number)
)

// Join: each transition starts on the bar line where the next scene begins.
console.log('joining')
const inputs = files.flatMap((f) => ['-i', f])
const chain = []
let previous = '[0:v]'
SCENES.slice(0, -1).forEach((scene, i) => {
  const offset = scene.bars[1] * BAR
  const next = `[x${i}]`
  const kind = scene.into === 'end' ? 'fade' : scene.into
  const duration = kind === 'fade' && (i === 0 || i === SCENES.length - 2) ? CUT * 2 : CUT
  chain.push(
    `${previous}[${i + 1}:v]xfade=transition=${kind}:duration=${fmt(duration)}:offset=${fmt(offset)}${next}`
  )
  previous = next
})
const total = SCENES.at(-1).bars[1] * BAR
const audio = files.length
const credit = files.length + 1
const music = join(out, 'music', MUSIC.local)
if (!existsSync(music)) throw new Error(`${music} is missing: run node media/trailer/music.mjs`)
const trailer = join(site, 'trailer.mp4')
// The music credit sits bottom right from just after the title card to just before the end;
// the music fades in briefly and fades out over the end card.
const creditIn = SCENES[0].bars[1] * BAR - 0.6
const creditOut = total - FADE_OUT
ffmpeg([
  ...inputs,
  '-i',
  music,
  '-loop',
  '1',
  '-t',
  fmt(total),
  '-i',
  png('music'),
  '-filter_complex',
  [
    chain.join(';'),
    `;[${credit}]format=rgba,fade=in:st=${fmt(creditIn)}:d=0.6:alpha=1,fade=out:st=${fmt(creditOut)}:d=0.8:alpha=1[credit]`,
    `;${previous}[credit]overlay=0:${FRAME.height - 120}[video]`,
    `;[${audio}:a]atrim=0:${fmt(total)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=9,`,
    `afade=t=in:st=0:d=0.8,afade=t=out:st=${fmt(total - FADE_OUT)}:d=${fmt(FADE_OUT)}[a]`
  ].join(''),
  '-map',
  '[video]',
  '-map',
  '[a]',
  '-t',
  fmt(total),
  ...ENCODE,
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-movflags',
  '+faststart',
  trailer
])

// A poster (from History) and a short, light GIF of the highlights for the README.
const poster = SCENES.find((s) => s.id === '4-history')
ffmpeg([
  '-ss',
  fmt(poster.bars[0] * BAR + 2.2),
  '-i',
  trailer,
  '-frames:v',
  '1',
  '-q:v',
  '2',
  join(site, 'trailer-poster.jpg')
])
const gif = join(site, 'trailer.gif')
const clips = ['1-drops', '2-upnext', '4-history'].map((id) => SCENES.find((s) => s.id === id))
const parts = clips.map(
  (s, i) =>
    `[0:v]trim=${fmt(s.bars[0] * BAR + 0.6)}:${fmt(s.bars[0] * BAR + 4.6)},setpts=PTS-STARTPTS[g${i}]`
)
ffmpeg([
  '-i',
  trailer,
  '-filter_complex',
  `${parts.join(';')};${clips.map((_, i) => `[g${i}]`).join('')}concat=n=${clips.length}:v=1,fps=12,scale=880:-1:flags=lanczos,split[p][q];[p]palettegen=max_colors=128:stats_mode=diff[pal];[q][pal]paletteuse=dither=sierra2_4a`,
  '-loop',
  '0',
  gif
])
for (const f of [trailer, gif, join(site, 'trailer-poster.jpg')]) {
  console.log(`${f}: ${(statSync(f).size / 1e6).toFixed(1)} MB`)
}
