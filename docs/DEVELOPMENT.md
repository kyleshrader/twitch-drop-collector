# Developer guide

How to build, test and change Twitch Drop Collector. For what the app does, see the [README](../README.md) and the [website](https://kyleshrader.github.io/twitch-drop-collector/).

## Stack

- **Electron** (main, preload and renderer processes), **React** and **TypeScript**, in a **Yarn** (Modern) workspace monorepo with `nodeLinker: node-modules`, orchestrated by **Turborepo**.
- **electron-vite** builds the app, **electron-builder** packages it, and **electron-updater** updates it from GitHub releases.
- **zod** schemas define every IPC message and setting. The local database is Node's built-in `node:sqlite`.
- **Vitest** runs the unit tests (also on Electron's own Node, for the code that runs there) and **Playwright** the end-to-end tests, against a mock Twitch.

## Setup

```bash
fnm use                    # the Node version in .node-version
corepack enable            # on Node 25+, run `npm install -g corepack` first
yarn install --immutable
yarn dev                   # the app, with hot reload
```

## Checks

```bash
yarn check       # Yarn constraints, typecheck, lint, unit tests, and tests on Electron's Node
yarn test:e2e    # builds the app, then runs Playwright against it
yarn format      # Prettier (CI runs format:check)
```

End-to-end windows stay invisible so they don't get in your way. Set `TDC_E2E_SHOW_WINDOWS=1` to watch them. The tests never talk to the real Twitch: `e2e/tests/mock-twitch.ts` answers with anonymised captures of real responses (`packages/api/fixtures/twitch/`), with their dates moved to now.

`yarn test:packaged` packs the app (unpacked, into `apps/desktop/dist`) and checks its fuses, that it starts, and the asar integrity.

## Layout

| Path                                 | What                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop`                       | The Electron app: `src/main` (network, storage, OS integration), `src/preload` (the typed bridge), `src/renderer` (React) |
| `apps/desktop/src/renderer/src/next` | The UI: CSS modules, its strings, icons only through `next/icons.ts`                                                      |
| `packages/kernel`                    | Logger, clock and other basics; imports nothing from the workspace or the platform                                        |
| `packages/core`                      | Domain rules, the miner, the Up next queue, services                                                                      |
| `packages/api`                       | Twitch: HTTP, GQL, PubSub, watching, sign-in, and the API change checks                                                   |
| `packages/storage`                   | The SQLite database: cache, claims, campaigns seen, watch sessions, events                                                |
| `packages/config`                    | Settings: schema, defaults, migrations, the settings service                                                              |
| `packages/ipc-contract`              | Every IPC channel, with its input and output schemas                                                                      |
| `packages/ui`                        | Shared React components                                                                                                   |
| `tooling`                            | Shared tsconfig bases, ESLint boundary rules and their tests                                                              |
| `e2e`                                | Playwright tests (`tests/`) and the media recorder (`media/`)                                                             |
| `media`                              | The trailer pipeline (`media/trailer/`) and a local server for the site                                                   |
| `site`                               | The GitHub Pages site, published by `.github/workflows/pages.yml`                                                         |
| `docs`                               | The spec, the decision log and the design notes                                                                           |

## Rules

These are enforced by lint, Yarn constraints and tests wherever they can be:

- Network, secrets, storage and OS integration run in the main process only.
- The renderer talks to main only through the typed preload API, and main validates every IPC input.
- Windows keep `contextIsolation`, `sandbox` and `nodeIntegration: false`.
- `packages/kernel`, `core`, `api`, `storage` and `config` never import Electron or React. `packages/kernel` imports nothing from the workspace and no Node, DOM or Electron APIs. The renderer imports only `packages/ui` and `packages/ipc-contract`.
- Tokens are never stored in plain text or in renderer storage.
- Look up current versions and config syntax in each tool's docs; don't rely on memory. Record library and design choices in [decisions.md](decisions.md).

[CLAUDE.md](../CLAUDE.md) has the same rules for AI-assisted work.

## Docs

- [spec.md](spec.md): the stack and repository spec the project started from.
- [decisions.md](decisions.md): every library and design decision, with the reason, newest last.
- [port-plan.md](port-plan.md): the plan for porting TwitchDropsMiner's behaviour.
- [new-ui/ui-design.md](new-ui/ui-design.md): the UI's design. Also [queue-rules.md](new-ui/queue-rules.md) (how Up next sorts and splits) and [history.md](new-ui/history.md) (what History records and shows).

## The trailer, screenshots and site

The trailer and screenshots are generated from the app itself, so they can be remade after UI changes. [media/trailer/SCRIPT.md](../media/trailer/SCRIPT.md) has the script and the shot plan. To remake them you need ffmpeg on your `PATH`, plus a user data folder of your own with some history in it.

```bash
# 1. Demo data from your own database: copied, account details dropped, never session.bin
node media/trailer/demo-data.mjs "<user data>/tdc.db" "<user data>/settings.json"
# 2. Build the app, then record the scenes and take the screenshots (invisible windows)
yarn workspace @tdc/desktop build
yarn workspace @tdc/e2e media
# 3. The music (downloaded once), the overlays, then the trailer, poster and GIF (into site/media/)
node media/trailer/music.mjs
node media/trailer/overlays.mjs
node media/trailer/compose.mjs
# Preview the site
node media/serve-site.mjs
```

Everything under `media/trailer/out/` is a build product and is git-ignored, including the demo database. The music is [April Showers](https://freemusicarchive.org/music/holiznacc0/spring-at-last-lofi-tape/april-showers/) by HoliznaCC0, CC0 (public domain). `music.mjs` downloads it into `out/music/`, so it isn't kept in the repository. The trailer credits it bottom right.

## Releases

Bump `apps/desktop/package.json` and the version in the README's download table (its links name the version), then push a tag `v<version>`. The site's download section reads the releases from GitHub, so it needs no change. `.github/workflows/release.yml` builds the installers, signs them when the signing secrets are set, and publishes the GitHub release the updater reads. Installers can also be built locally with `yarn workspace @tdc/desktop build:win`, `build:mac` or `build:linux`.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run `yarn check`, `yarn test:e2e` and `yarn format`, and add an entry to [decisions.md](decisions.md) for any new library or design choice.
