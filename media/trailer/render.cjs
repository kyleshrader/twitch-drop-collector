// Electron main that renders HTML to PNG, transparency kept (an offscreen, transparent window).
// Used by overlays.mjs and the site's images: `electron render.cjs jobs.json`, where each job is
// { html, out, width, height }.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { pathToFileURL } = require('node:url')

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    const jobs = JSON.parse(readFileSync(process.argv[process.argv.length - 1], 'utf8'))
    const window = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      transparent: true,
      frame: false,
      useContentSize: true,
      enableLargerThanScreen: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: true }
    })
    for (const job of jobs) {
      window.setContentSize(job.width, job.height)
      await window.loadURL(pathToFileURL(job.html).href)
      await window.webContents.executeJavaScript(
        'document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300)))'
      )
      const image = await window.webContents.capturePage({
        x: 0,
        y: 0,
        width: job.width,
        height: job.height
      })
      writeFileSync(job.out, image.toPNG())
    }
    window.destroy()
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
