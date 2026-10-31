// CI diagnostic for Linux: prints the backend Electron's safeStorage picked (basic_text means no
// keyring). Run with: electron tooling/scripts/print-safe-storage-backend.cjs
const { app, safeStorage } = require('electron')

app.whenReady().then(async () => {
  try {
    // getSelectedStorageBackend exists on Linux only.
    if (process.platform === 'linux') {
      console.log('safeStorage backend:', safeStorage.getSelectedStorageBackend())
    }
    console.log('async encryption available:', await safeStorage.isAsyncEncryptionAvailable())
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
