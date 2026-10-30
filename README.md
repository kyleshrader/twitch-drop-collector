# Twitch Drop Collector

Cross-platform desktop app (Electron + React + TypeScript) in a Yarn workspace monorepo.

## Setup

```bash
fnm use                    # Node from .node-version
corepack enable            # on Node 25+, run `npm install -g corepack` first
yarn install --immutable
yarn dev
```

## Checks

```bash
yarn check      # constraints, typecheck, lint, test
yarn test:e2e   # builds the app and runs Playwright against it
```

## Layout

- `apps/desktop`: Electron app (`src/main`, `src/preload`, `src/renderer`)
- `packages/*`: `kernel`, `core`, `api`, `storage`, `config`, `ipc-contract`, `ui`
- `tooling`: shared tsconfig bases, ESLint boundary rules and their tests
- `e2e`: Playwright tests that launch the built app
- `docs`: [spec](docs/spec.md) and [decision log](docs/decisions.md)
