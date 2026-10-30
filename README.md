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
yarn check   # constraints, typecheck, lint, test
```

## Layout

- `apps/desktop`: Electron app (`src/main`, `src/preload`, `src/renderer`)
- `packages/*`: `core`, `api`, `storage`, `config`, `ipc-contract`, `ui`
- `tooling`: shared tsconfig bases, ESLint boundary rules and their tests
- `docs`: [spec](docs/spec.md) and [decision log](docs/decisions.md)
