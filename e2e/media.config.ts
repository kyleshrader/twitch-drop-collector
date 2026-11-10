import { defineConfig } from '@playwright/test'

// Records the trailer's scenes and takes the site's screenshots (media/trailer/SCRIPT.md). Not part
// of the end-to-end tests: run it with `yarn workspace @tdc/e2e media`.
export default defineConfig({
  testDir: './media',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  reporter: 'list'
})
