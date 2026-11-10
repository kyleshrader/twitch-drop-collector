/* global document */
// The dark vs light comparison: the range input moves the divide.
for (const compare of document.querySelectorAll('[data-compare]')) {
  const input = compare.querySelector('input')
  const set = () => compare.style.setProperty('--at', `${input.value}%`)
  input.addEventListener('input', set)
  set()
}

// Downloads: every release from GitHub, newest first, with a file per platform. The page's own
// links (to the release it was published with) stay if GitHub can't be reached.
const REPO = 'kyleshrader/twitch-drop-collector'
const KINDS = {
  win: { name: 'Windows', match: /-setup\.exe$/i },
  mac: { name: 'macOS', match: /\.dmg$/i },
  appimage: { name: 'Linux', match: /\.AppImage$/i },
  deb: { name: 'Debian and Ubuntu', match: /\.deb$/i }
}

/** The visitor's platform, when it's one there's a download for. */
function detect() {
  const platform =
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
  const agent = navigator.userAgent
  if (/android|iphone|ipad/i.test(agent)) return undefined
  if (/win/i.test(platform)) return 'win'
  if (/mac/i.test(platform)) return 'mac'
  if (/linux/i.test(platform)) return /debian|ubuntu/i.test(agent) ? 'deb' : 'appimage'
  return undefined
}

const size = (bytes) => `${Math.round(bytes / 1e6)} MB`
const date = (iso) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))

async function releases() {
  try {
    const cached = sessionStorage.getItem('tdc-releases')
    if (cached) return JSON.parse(cached)
  } catch {
    // No session storage: fetch every time.
  }
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`)
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  const list = (await response.json())
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      prerelease: r.prerelease,
      published: r.published_at,
      url: r.html_url,
      files: Object.fromEntries(
        Object.entries(KINDS).flatMap(([kind, { match }]) => {
          const asset = r.assets.find((a) => match.test(a.name))
          return asset
            ? [[kind, { url: asset.browser_download_url, size: asset.size, name: asset.name }]]
            : []
        })
      )
    }))
    .filter((r) => Object.keys(r.files).length > 0)
  try {
    sessionStorage.setItem('tdc-releases', JSON.stringify(list))
  } catch {
    // Not cached; fine.
  }
  return list
}

function showRelease(release) {
  document.querySelector('[data-notes]').href = release.url
  for (const card of document.querySelectorAll('.platform')) {
    const file = release.files[card.dataset.kind]
    const link = card.querySelector('[data-file]')
    const note = card.querySelector('[data-size]')
    if (file) {
      link.href = file.url
      link.removeAttribute('aria-disabled')
      note.textContent = `${file.name} · ${size(file.size)}`
    } else {
      link.removeAttribute('href')
      link.setAttribute('aria-disabled', 'true')
      note.textContent = 'Not in this version'
    }
  }
}

async function setUpDownloads() {
  const kind = detect()
  const yours = kind && document.querySelector(`.platform[data-kind="${kind}"]`)
  if (yours) {
    yours.classList.add('detected')
    yours.querySelector('.yours').hidden = false
  }
  const buttons = document.querySelectorAll('[data-download]')
  const label = (release) => {
    const file = kind && release && release.files[kind]
    for (const button of buttons) {
      if (file) {
        button.href = file.url
        button.textContent = `Download for ${KINDS[kind].name}`
      } else if (kind && yours) {
        button.href = yours.querySelector('[data-file]').href
        button.textContent = `Download for ${KINDS[kind].name}`
      }
    }
    const note = document.querySelector('[data-download-note]')
    if (note && file) {
      note.textContent = `${release.name}${release.prerelease ? ' (beta)' : ''} · ${size(file.size)} ·`
    }
  }
  label()

  let list
  try {
    list = await releases()
  } catch {
    return // The page's own links stay.
  }
  if (list.length === 0) return
  const select = document.querySelector('[data-versions]')
  select.replaceChildren(
    ...list.map((r) => {
      const option = document.createElement('option')
      option.value = r.tag
      option.textContent = `${r.name}${r.prerelease ? ' (beta)' : ''} · ${date(r.published)}`
      return option
    })
  )
  select.addEventListener('change', () => showRelease(list.find((r) => r.tag === select.value)))
  showRelease(list[0])
  label(list[0])
}
setUpDownloads()
