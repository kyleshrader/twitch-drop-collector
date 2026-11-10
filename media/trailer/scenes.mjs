// The trailer's scenes (SCRIPT.md): timings in bars of the 170 BPM beat, the text on screen,
// the recorded clip each one uses, and how the cut into the next one looks.
export const BPM = 170
export const BAR = (60 / BPM) * 4
export const FPS = 30
export const FRAME = { width: 1920, height: 1080 }
/** Where the app sits in the frame: 1440 × 810, centred, under a 150 px header band. */
export const WINDOW = { x: 240, y: 150, width: 1440, height: 810 }
/**
 * The music: April Showers by HoliznaCC0, CC0 1.0 (public domain), from Free Music Archive.
 * music.mjs downloads it into out/music/. The cuts follow the 170 BPM bar grid the scenes were
 * planned on, not the track.
 */
export const MUSIC = {
  title: 'April Showers',
  artist: 'HoliznaCC0',
  licence: 'CC0',
  source: 'Free Music Archive',
  page: 'https://freemusicarchive.org/music/holiznacc0/spring-at-last-lofi-tape/april-showers/',
  file: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/SZQum7R8bPGg4PsamRg7Ikk5Cs7mTgrELzE1LYDu.mp3',
  local: 'april-showers.mp3'
}
/** How long the music fades out at the end, in seconds. */
export const FADE_OUT = 5
/** A transition's length, in seconds. */
export const CUT = BAR / 4

/**
 * crop: the part of the recording shown (x, y, width, height in the 1440 × 810 recording),
 * zoomed to fill the window; for the narrow pages.
 */
export const SCENES = [
  { id: 'title', bars: [0, 4], kind: 'card', into: 'fade' },
  {
    id: '1-drops',
    bars: [4, 10],
    header: 'It watches for you',
    sub: 'Picks a stream, earns the drops, claims them.',
    caption: 'Watches the right stream in the background and claims as it goes',
    into: 'slideleft'
  },
  {
    id: '2-upnext',
    bars: [10, 16],
    header: 'Your queue, your order',
    sub: 'Drag, sort, collect now.',
    caption: 'Every campaign it can earn, in the order you want',
    into: 'wipeup'
  },
  {
    id: '3-library',
    bars: [16, 22],
    header: 'Every game in one library',
    sub: 'Box art, campaigns, linked accounts.',
    caption: 'Prioritise or exclude any game, even ones with no drops yet',
    into: 'slideleft'
  },
  {
    id: '4-history',
    bars: [22, 30],
    header: 'See everything it did',
    sub: 'Claims, watching, and how each campaign ended.',
    caption: 'A full history, kept on your computer and nowhere else',
    into: 'circleopen'
  },
  {
    id: '5-twitch-api',
    bars: [30, 34],
    header: 'Ready when Twitch changes',
    sub: 'Every response is checked.',
    caption: 'Spots API changes early and helps you report them',
    crop: { x: 120, y: 0, width: 1080, height: 607 },
    into: 'fade'
  },
  {
    id: '6-themes',
    bars: [34, 37],
    header: 'Dark, light, or your system’s',
    sub: '',
    caption: '',
    crop: { x: 120, y: 0, width: 1080, height: 607 },
    into: 'fade'
  },
  { id: 'end', bars: [37, 42], kind: 'card', into: 'end' }
]

export const APP_SCENES = SCENES.filter((s) => s.kind !== 'card')
