# Project rules

Twitch Drop Collector: Electron + React + TypeScript desktop app in a Yarn monorepo.
Full spec: docs/spec.md. Decision log: docs/decisions.md.

## Commands

- Node: `fnm use` (reads .node-version). Corepack must be installed on Node 25+.
- Install: yarn install --immutable
- Dev: yarn dev
- Checks: yarn check (constraints, typecheck, lint, test, and test:electron for code that runs on Electron's Node)
- End-to-end: yarn test:e2e (builds the app, then runs Playwright against it; windows stay invisible, set TDC_E2E_SHOW_WINDOWS=1 to watch)
- Packaged build: yarn test:packaged (packs the app unpacked into apps/desktop/dist, then checks fuses, startup and asar integrity); installers: yarn workspace @tdc/desktop build:win|build:mac|build:linux

## Always

- Network, secrets, storage and OS integration run in the main process only.
- Renderer talks to main only through the typed preload API; main validates every IPC input.
- Windows keep contextIsolation, sandbox, and nodeIntegration: false.
- packages/kernel, core, api, storage, config never import electron or react.
- packages/kernel imports nothing from the workspace and no Node/DOM/Electron APIs.
- Renderer imports only packages/ui and packages/ipc-contract.
- Look up current versions and config syntax in docs; don't rely on memory.
- Log library and design choices in docs/decisions.md.

## Never

- Weaken lint boundaries or Yarn constraints to make something compile.
- Expose ipcRenderer or Node APIs to the renderer.
- Store tokens in plain text or in renderer storage.
