# Electron Desktop App: Stack and Repo Setup Spec

Oct 29, 2026 · @Kyle Shrader

## How to use this spec

This spec sets goals, constraints, and acceptance criteria for a cross-platform Electron app in a Yarn monorepo. It leaves most library and configuration choices to you. Every decision falls into one of three tiers:

- **Fixed:** follow as written. These are either facts about the tools or security and architecture requirements. If one turns out to be impossible, stop and ask the user before working around it.
- **Default:** use unless you find a concrete reason not to, such as a maintenance problem, an incompatibility, or a requirement the default can't meet. Record any deviation in the decision log.
- **Delegated:** choose yourself after checking current documentation, and record the choice and reason in the decision log.

Workflow:

1. Before writing code, read this spec, ask the user the open decisions marked "ask first", and propose a plan for milestone M1.
2. Look up current versions and configuration syntax in each tool's documentation or with `npm view <package>`. This spec avoids version numbers and config snippets on purpose, because both go stale.
3. Keep a decision log at `docs/decisions.md`, one short entry per decision: date, decision, alternatives considered, reason.
4. Finish each milestone with its acceptance criteria met before starting the next. If a milestone reveals a problem with this spec, say so instead of quietly working around it.

## Product requirements

The app must:

- Run on Windows, macOS, and Linux from one codebase.
- Use a React UI.
- Talk to remote services over a custom auth scheme, GraphQL, and JSON/REST.
- Optionally launch at login, controlled by a user setting.
- Persist user configuration across restarts.
- Store keys and tokens using the operating system's secure storage.
- Keep a local cache of remote data.
- Ship as signed installers with auto-update.

Assumed from earlier discussion and worth confirming: the app runs as a single instance, can keep running in the system tray when its window is closed, and keeps all secrets and network calls out of the renderer process.

## Fixed decisions

### Platform and build tooling

- Electron, React, and TypeScript.
- Yarn Modern, latest stable, with `nodeLinker: node-modules`. electron-builder needs a real `node_modules` tree and does not work with Plug'n'Play ([electron-builder README](https://github.com/sunbat520/electron-builder)).
- Yarn is pinned with the `packageManager` field and run through Corepack. Corepack is no longer bundled with Node.js 25 and later, so dev setup docs and CI must install it explicitly ([OpenReplay](https://blog.openreplay.com/manage-package-managers-node-corepack/)).
- Yarn workspaces with `apps/` and `packages/` directories.
- electron-vite builds the main process, preload script, and renderer. Electron Forge's Vite plugin is marked experimental, with possible breaking changes in minor releases, so it is excluded ([Forge Vite plugin](https://npmjs.com/package/%40electron-forge%2Fplugin-vite)).
- electron-builder produces installers, and electron-updater handles auto-update.

### Process boundaries and security

- Network calls, secrets, storage, and OS integration run only in the main process. The renderer reaches them through the API the preload script exposes.
- Every `BrowserWindow` has `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. The renderer has a strict Content-Security-Policy. `window.open` and navigation to external origins are denied, and external links open in the system browser.
- Every IPC channel is defined once in a shared contract with runtime schema validation, and the main process validates input before acting on it. `ipcRenderer` is never exposed to the renderer directly.
- Long-lived secrets (refresh tokens, API keys) are encrypted with Electron's `safeStorage` and written under `app.getPath('userData')`. Access tokens stay in memory. On Linux, check `safeStorage.getSelectedStorageBackend()`; a result of `basic_text` means no keyring, and the behaviour in that case is an open decision.
- Main-process HTTP goes through Electron's `net.fetch`, which uses the system proxy settings and certificate store.
- Electron fuses disable run-as-node, the `NODE_OPTIONS` variable, and CLI inspect flags, and enable asar integrity validation and loading only from the asar archive.
- The app holds a single-instance lock; a second launch focuses the existing window.

### Architecture

- Domain logic (auth flow, API clients, storage, configuration) lives in workspace packages that never import `electron` or `react`. Anything Electron-specific is passed in through a TypeScript interface, implemented in `apps/desktop`. This keeps the logic testable in plain Node.
- The dependency rules in the layout section are enforced by ESLint and Yarn constraints from milestone M1.
- Workspace packages are bundled into the app. Only native modules and packages that must load from disk at runtime are listed as `dependencies` of `apps/desktop`.

### Quality gates

- TypeScript strict mode in every workspace.
- CI runs on Windows, macOS, and Linux: immutable install, Yarn constraints, typecheck, lint, unit tests, and end-to-end tests.
- Release builds are signed and notarized on macOS and signed on Windows.

## Defaults

Use these unless you find a concrete reason not to, and log any deviation.

| Area                      | Default                                              | Acceptable alternatives                                                  | Reason to deviate                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task runner               | Turborepo                                            | Nx; plain `yarn workspaces foreach`                                      | Turborepo adds no value at the repo's size, or Nx's boundary tooling is needed                                                                                                              |
| Shared versions           | Yarn catalogs (Yarn 4.10+)                           | Explicit ranges plus a constraint enforcing consistency                  | electron-builder can't resolve `catalog:` in `apps/desktop`                                                                                                                                 |
| Remote and IPC data in UI | TanStack Query                                       | SWR                                                                      | None expected                                                                                                                                                                               |
| Runtime validation        | zod                                                  | valibot                                                                  | Bundle size in the renderer becomes a measured problem                                                                                                                                      |
| User configuration        | electron-store with a schema                         | A small JSON file wrapper in `packages/config`                           | electron-store's ESM-only build or schema handling causes friction                                                                                                                          |
| Local database            | better-sqlite3                                       | Node's built-in `node:sqlite`, if stable in the bundled Electron version | Native-module build problems on a target platform                                                                                                                                           |
| Query layer               | Drizzle ORM                                          | Kysely; plain SQL with typed helpers                                     | Drizzle's migration story doesn't fit; keep whichever you use updated, since Drizzle had a SQL injection fix in April 2026 ([CVE-2026-39356](https://exploit-intel.com/vendor/npm?page=17)) |
| Lint and format           | ESLint (flat config, typescript-eslint) and Prettier | Biome for formatting, ESLint for rules                                   | Biome can enforce the dependency rules equally well                                                                                                                                         |
| Boundary lint rule        | eslint-plugin-boundaries                             | `import/no-restricted-paths`                                             | Simpler config                                                                                                                                                                              |
| Unit tests                | Vitest                                               | None                                                                     | None expected                                                                                                                                                                               |
| End-to-end tests          | Playwright with its Electron support                 | WebdriverIO                                                              | Playwright's Electron support is marked experimental and proves unreliable                                                                                                                  |
| Logging                   | electron-log                                         | pino with a file transport                                               | Structured logs are needed for a log backend                                                                                                                                                |

## Delegated decisions

Choose these yourself and log each one. Prefer libraries that are actively maintained, have TypeScript types, work in the process they're used in (renderer, main, or both), and add the fewest dependencies.

- Routing in the renderer (for example TanStack Router or React Router). The app has a handful of screens to start with: settings, sign-in, and a main view.
- Local UI state, if TanStack Query and React state aren't enough.
- Component library and styling approach. Requirements: accessible primitives, a theme that follows the OS light/dark setting, and components owned in `packages/ui`.
- GraphQL client and code generation setup. Requirements: runs in the main process, produces typed operations, and takes an injected `fetch`.
- How the typed IPC layer is built: hand-written from the shared contract, or a library. If you pick a library, check its maintenance status first.
- Crash reporting provider, subject to the open decision on user consent.
- TypeScript strictness flags beyond `strict`.
- Exact configuration of every tool: electron-vite externals, electron-builder targets and fuse keys, Turborepo tasks, tsconfig layout, and CI caching. Get the syntax from current docs.
- Package names inside the `packages/` directory, if the suggested split doesn't fit what you find while building.

## Repository layout and dependency rules

The directory layout is a suggestion; adjust package boundaries if building reveals a better split, and log the change. The dependency rules are fixed.

```
repo/
  apps/
    desktop/
      src/
        main/          # lifecycle, windows, tray, IPC handlers, adapters
        preload/       # exposes the typed API from the IPC contract
        renderer/      # React app
  packages/
    core/              # auth flow, sync, domain rules
    api/               # GraphQL and REST clients
    storage/           # database schema, migrations, cache
    config/            # settings schema, defaults, migrations
    ipc-contract/      # channel definitions and schemas
    ui/                # shared React components
  tooling/             # shared tsconfig and lint config
  e2e/                 # end-to-end tests
  docs/
    decisions.md       # decision log
  CLAUDE.md
```

### Dependency rules (fixed)

1. `core`, `api`, `storage`, and `config` never import `electron` or `react`. Electron-specific capabilities (encryption, file paths, fetch, autostart) are interfaces in these packages, implemented in `apps/desktop/src/main`.
2. `core` may import `api`, `storage`, and `config`. Those three do not import each other or `core`.
3. `ui` imports only React and UI or styling libraries.
4. The renderer may import `ui` and `ipc-contract`, and nothing from `core`, `api`, `storage`, or `config`.
5. The preload script may import only `ipc-contract` and `electron`.
6. The main process may import every package except `ui`.
7. `ipc-contract` depends only on the validation library, since both sides of the process boundary import it.

## Known pitfalls

These are problems likely to come up. Some are unverified; check them against current docs when you reach them.

- Sandboxed preload scripts cannot use ESM. Build the preload script as CommonJS even if the main process is ESM.
- electron-vite externalizes `dependencies` by default. Workspace packages must be bundled instead, or the packaged app will fail to find them. The name of the setting has changed between electron-vite major versions.
- Native modules such as `better-sqlite3` are rebuilt for Electron's Node ABI by `electron-builder install-app-deps`. After that rebuild, Vitest running under plain Node can't load them. Pick a strategy (run those tests through Electron with `ELECTRON_RUN_AS_NODE=1`, or rebuild per context), script it, and log it.
- Native `.node` files must be unpacked from the asar archive in packaged builds.
- `electron` must be in `devDependencies` of `apps/desktop` for electron-builder.
- Unverified: whether electron-builder resolves Yarn `catalog:` ranges when collecting production dependencies. Check in the first packaged build.
- `app.setLoginItemSettings` covers Windows and macOS only. On Linux, launch at login means writing a `.desktop` file to `~/.config/autostart`.
- Auto-update on macOS only works for signed builds. Test the update path with a staged pre-release before the first public release.
- Recent electron-store versions are ESM-only, as far as I know. Confirm the main process build format supports this before adopting it.
- Playwright end-to-end tests on Linux CI need a virtual display (`xvfb-run`).
- CI runners on Node.js 25 or later need `npm install -g corepack` before `corepack enable`.

## Milestones

Each milestone says what must be true before moving on. How to get there is up to you within the fixed decisions.

- [ ] M0. Plan: ask the user the "ask first" open decisions, create `docs/decisions.md`, and propose the M1 plan. Done when the user has approved the plan.
- [ ] M1. Repo skeleton: Yarn, workspaces, shared TypeScript and lint config, dependency rules enforced, empty packages. Done when a fresh clone installs with `yarn install --immutable`, and typecheck, lint, tests, and Yarn constraints all pass, and a deliberately forbidden import fails lint.
- [ ] M2. Desktop shell: a window with the React renderer, hot reload in development, the fixed security settings, and the single-instance lock. Done when the security settings are checked by a test.
- [ ] M3. IPC: the shared contract, typed preload API, and validated handlers, with one real channel used from the renderer. Done when an invalid payload is rejected in main and a unit test covers it.
- [ ] M4. Configuration and launch at login: typed settings that persist, a settings screen, and a launch-at-login toggle working on all three platforms. Done when an end-to-end test shows settings surviving a restart.
- [ ] M5. Local storage and cache: database, migrations run at startup, and a cache with expiry. Done when storage tests pass in CI on all three platforms.
- [ ] M6. Network: REST and GraphQL clients in main with typed responses and validation, using `net.fetch` through an adapter. Done when the clients are unit-tested against a mock server.
- [ ] M7. Auth: sign-in, token refresh, sign-out, and secret storage, following the auth scheme the user describes. Done when an end-to-end test signs in and out against a mock auth server and no token is reachable from the renderer.
- [ ] M8. Background behaviour: tray icon, optional hide-on-close, and state changes pushed from main to the renderer. Done when closing the window with hide-on-close enabled keeps the app running.
- [ ] M9. Logging and crash reporting. Done when a forced error in each process appears in the logs, and crash reporting is off until the user's consent setting allows it.
- [ ] M10. Packaging: unsigned installers for each platform, with fuses set. Done when the installed app launches, loads its native modules, and reaches the main window on each platform.
- [ ] M11. CI and release: CI on all three platforms, signed release builds, and auto-update. Done when a tagged pre-release produces signed installers and an older build updates to it.
- [ ] M12. End-to-end coverage of the flows above, running in CI on all three platforms.

## Open decisions

Items marked "ask first" are asked in M0. The rest can wait until the milestone listed, using the fallback if the user has no preference.

| Decision                                                                                                                                | When      | Fallback if no preference                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| How the custom auth works: standard OIDC/OAuth 2, a variant, or a proprietary scheme; token types and lifetimes; how sign-in is started | Ask first | None. M7 cannot be designed without it.                      |
| App ID, product name, and package scope                                                                                                 | Ask first | `com.example.app`, "Example App", `@app`                     |
| Target OS versions and CPU architectures                                                                                                | Ask first | Current and previous major version of each OS; x64 and arm64 |
| Whether offline use and background sync are needed                                                                                      | Ask first | Online-only with a read cache                                |
| GraphQL schema source: introspection URL or a schema file in the repo                                                                   | M6        | Schema file in the repo                                      |
| Sign-in redirect method: custom protocol or loopback server                                                                             | M7        | Custom protocol, if the auth scheme uses redirects           |
| Persist secrets on Linux when no keyring is available                                                                                   | M7        | No; user signs in each launch                                |
| Crash reporting provider and consent                                                                                                    | M9        | Opt-in setting, off by default                               |
| Linux formats beyond AppImage and deb                                                                                                   | M10       | AppImage and deb only                                        |
| Update hosting: GitHub Releases, S3, or generic HTTPS                                                                                   | M11       | GitHub Releases                                              |
| Windows signing: Azure Trusted Signing or a certificate                                                                                 | M11       | Azure Trusted Signing                                        |

## Suggested CLAUDE.md

Claude Code loads `CLAUDE.md` into every session, so keep it short and put this full spec at `docs/spec.md`. A starting version:

```markdown
# Project rules

Electron + React + TypeScript desktop app in a Yarn monorepo.
Full spec: docs/spec.md. Decision log: docs/decisions.md.

## Commands

- Install: yarn install --immutable (Corepack must be installed on Node 25+)
- Dev: yarn dev
- Checks: yarn typecheck && yarn lint && yarn test && yarn constraints

## Always

- Network, secrets, storage and OS integration run in the main process only.
- Renderer talks to main only through the typed preload API; main validates every IPC input.
- Windows keep contextIsolation, sandbox, and nodeIntegration: false.
- packages/core, api, storage, config never import electron or react.
- Renderer imports only packages/ui and packages/ipc-contract.
- Look up current versions and config syntax in docs; don't rely on memory.
- Log library and design choices in docs/decisions.md.

## Never

- Weaken lint boundaries or Yarn constraints to make something compile.
- Expose ipcRenderer or Node APIs to the renderer.
- Store tokens in plain text or in renderer storage.
```

## Sources

- [Yarn catalogs documentation](https://yarnpkg.com/features/catalogs)
- [Corepack no longer bundled with Node.js 25](https://blog.openreplay.com/manage-package-managers-node-corepack/)
- [electron-builder README, Yarn PnP note](https://github.com/sunbat520/electron-builder)
- [Electron Forge Vite plugin, experimental status](https://npmjs.com/package/%40electron-forge%2Fplugin-vite)
- [Drizzle CVE-2026-39356 listing](https://exploit-intel.com/vendor/npm?page=17)
