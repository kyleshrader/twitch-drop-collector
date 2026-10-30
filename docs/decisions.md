# Decision log

One entry per decision: date, decision, alternatives considered, reason. Newest last.

## 2026-10-29 · M0 answers

- **Identity:** appId `com.github.twitchdropcollector`, product name "Twitch Drop Collector", package scope `@tdc`.
- **Targets:** every OS version the bundled Electron supports; x64 and arm64.
- **Offline / background:** drops can only be collected online, but the app detects offline state, pauses and resumes cleanly, and keeps working in the background while minimised to the tray.
- **Auth:** OAuth device code flow using a specific client ID. Details (client ID, token lifetimes, refresh) settled at M7.

## 2026-10-29 · Node version file is `.node-version`

- **Decision:** pin Node 24 (current LTS) in `.node-version`.
- **Alternatives:** `.node-versions` (as first requested), `.nvmrc`, `engines` with `fnm --resolve-engines`.
- **Reason:** fnm reads only `.node-version` and `.nvmrc`; the plural name is not recognised.

## 2026-10-29 · Yarn 4.18.1, `nodeLinker: node-modules`, scripts disabled for dependencies

- **Decision:** created with `yarn init -2`, pinned by `packageManager`. This Yarn reports `enableScripts: false`, so dependency build scripts don't run; we keep that default.
- **Alternatives:** set `enableScripts: true` globally, or per-package `dependenciesMeta.<pkg>.built`.
- **Reason:** safer default. Electron 45 downloads its binary through its `install-electron` bin, which the desktop workspace's own `postinstall` runs. Native modules are rebuilt by `electron-builder install-app-deps` in the same script. Revisit at M5 if better-sqlite3 needs a prebuild step.

## 2026-10-29 · Scaffold with `@quick-start/create-electron`, then trim

- **Decision:** `yarn dlx @quick-start/create-electron@1.0.31 desktop --template react-ts --skip` in `apps/`, then removed its ESLint/Prettier/tsconfig presets (replaced by `tooling/` and root configs) and `@electron-toolkit/preload`.
- **Alternatives:** hand-write the electron-vite app; keep the toolkit presets.
- **Reason:** official electron-vite scaffolder. `@electron-toolkit/preload` exposes `ipcRenderer` to the renderer, which the spec forbids, and it would also break dependency rule 5. `@electron-toolkit/utils` stays in main for now (dev shortcuts, `is.dev`).

## 2026-10-29 · TypeScript 6.0, not 7

- **Decision:** `typescript: ~6.0.3` in the catalog.
- **Alternatives:** TypeScript 7.0.2 (latest).
- **Reason:** typescript-eslint 8.72 peers on `typescript >=4.8.4 <6.1.0`. Revisit when typescript-eslint supports 7.

## 2026-10-29 · TypeScript strictness beyond `strict`

- **Decision:** `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`.
- **Alternatives:** also `exactOptionalPropertyTypes`.
- **Reason:** catches real bugs at low cost. `exactOptionalPropertyTypes` causes friction with many library types; skip unless needed.
- Shared bases live in `tooling/tsconfig/` (`base`, `node`, `web`). `ipc-contract` uses `base` with no DOM or Node types, since both sides import it.

## 2026-10-29 · ESLint 10 without eslint-plugin-react

- **Decision:** ESLint 10 flat config with typescript-eslint, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `eslint-config-prettier`.
- **Alternatives:** stay on ESLint 9 to keep `eslint-plugin-react` 7.37.5, which doesn't support ESLint 10.
- **Reason:** with the automatic JSX runtime and TypeScript, eslint-plugin-react adds little; the hooks and refresh plugins already support ESLint 10.

## 2026-10-29 · Boundary enforcement: eslint-plugin-boundaries 7, single root config

- **Decision:** `boundaries/dependencies` with `default: 'disallow'` and `checkAllOrigins: true`, so external packages (`electron`, `react`) and Node built-ins are checked as well as workspace imports. Elements are folders (each package, and main, preload and renderer). Imports resolve through `eslint-import-resolver-typescript`. Lint runs once from the root (`yarn lint`), not per package through Turborepo, because the rules need the whole-repo view.
- **Alternatives:** `import/no-restricted-paths`; per-package ESLint configs.
- **Reason:** the spec default; it can express rules 1–7 including external modules. `tooling/eslint/boundaries.test.ts` lints forbidden and allowed imports for every rule, which is the M1 "forbidden import fails lint" check.

## 2026-10-29 · Yarn constraints

- **Decision:** `yarn.config.cjs` enforces private workspaces, `catalog:` for catalogued packages, consistent ranges for everything else, rules 1, 2 and 7 at the manifest level, and for `@tdc/desktop`: `electron` as an exact devDependency and no `@tdc/*` runtime dependencies.
- **Reason:** catches violations that never reach an import statement (for example, adding `react` to a domain package's manifest).

## 2026-10-29 · Workspace packages are source-only and bundled

- **Decision:** packages export `./src/index.ts` directly and have no build step. `@tdc/desktop` lists them in `devDependencies`, so electron-vite bundles them. No `build.externalizeDeps` override is needed.
- **Alternatives:** compile each package; list them in `dependencies` with `externalizeDeps.exclude`.
- **Reason:** simplest; checked that the M1 build output has no `@tdc/*` requires. `dependencies` of the desktop app stay reserved for native modules (spec).

## 2026-10-29 · Electron pinned to an exact version

- **Decision:** `electron: 45.1.0` (exact) in `@tdc/desktop`, not in the catalog.
- **Reason:** electron-builder can't read the hoisted install and needs an exact version (`install-app-deps` failed with `^45.1.0`). This also sidesteps the open question of whether electron-builder resolves `catalog:`, which is still to be checked at M10 for other runtime deps.

## 2026-10-29 · `@tdc/desktop` stays CommonJS

- **Decision:** no `"type": "module"` in `apps/desktop`; electron-vite emits CJS for main and preload.
- **Reason:** sandboxed preloads can't be ESM. Main can move to ESM at M4 if electron-store 12 (ESM-only) is adopted.

## 2026-10-29 · Turborepo kept, `tooling` is a workspace

- **Decision:** Turborepo runs `typecheck`, `test` and `build`. `tooling/` is the `@tdc/tooling` workspace so its tests run with everything else.
- **Alternatives:** `yarn workspaces foreach`.
- **Reason:** spec default; caching pays off once there are real packages. Turborepo collects anonymous telemetry by default (`turbo telemetry disable` turns it off).

## 2026-10-29 · Linux targets: AppImage and deb

- **Decision:** removed `snap` from the scaffold's electron-builder targets.
- **Reason:** spec fallback; revisit at M10.

## Carried into M2 (done in M2)

- `apps/desktop/src/main/index.ts` still has the scaffold's `sandbox: false`; there's no single-instance lock yet, and CSP and navigation rules aren't finalised. All of these are M2 scope.

## 2026-10-29 · LF line endings in git

- **Decision:** `* text=auto eol=lf` in `.gitattributes`.
- **Reason:** `.editorconfig` and Prettier use LF; with `core.autocrlf=true` on Windows, checkouts would otherwise be CRLF and `prettier --check` would fail.

## 2026-10-29 · M2: renderer served over `app://`, not `file://`

- **Decision:** production loads `app://renderer/index.html`, served by `protocol.handle` from `out/renderer`, with a path check that refuses anything outside that folder. Dev loads the Vite server URL.
- **Alternatives:** `loadFile` (scaffold default).
- **Reason:** Electron security checklist item 18; `file://` pages get extra privileges. A single known origin also makes the navigation check exact. `isSameOrigin` compares scheme and host because Node's `URL.origin` is `"null"` for custom schemes, which would make every custom scheme look same-origin.

## 2026-10-29 · M2: CSP as a meta tag written by a Vite plugin

- **Decision:** `index.html` has a placeholder that a small plugin in `electron.vite.config.ts` fills in: `default-src 'none'`, `script-src 'self'`, `style-src 'self'`, `connect-src 'self'` and so on in builds. Dev adds `'unsafe-inline'` to script and style only.
- **Alternatives:** a response header from the `app://` handler; nonces via Vite's `html.cspNonce`.
- **Reason:** one source for both modes. Vite's dev server injects the React Refresh preamble and CSS as inline tags. Packaged builds never get the dev policy; the e2e test checks that the built page has no `unsafe-*`.

## 2026-10-29 · M2: navigation, windows, permissions

- **Decision:** applied to every `webContents`: `setWindowOpenHandler` always denies; `will-navigate` blocks other origins; https URLs from either go to `shell.openExternal`, anything else is dropped. `will-attach-webview` is blocked, and the default session denies all permission requests and checks.
- **Reason:** spec, plus checklist items 5, 12–15. Permissions can be allowed one by one later if a feature needs them (for example notifications).

## 2026-10-29 · M2: security tests at two levels

- **Decision:** `apps/desktop/src/main/policy.test.ts` (Vitest) covers the window options and URL and path helpers. `e2e/` (Playwright `_electron`) launches the built app and checks the live `getLastWebPreferences()`, no Node globals in the renderer, the CSP (including a blocked inline script), denied popups and navigation, and the single-instance lock (a second launch exits 0 and restores the minimised window). Run with `yarn test:e2e`, which builds the app first.
- **Reason:** M2 acceptance. Both suites were checked by flipping `sandbox` to `false`; each failed.
- Playwright's Electron support is still marked experimental. It works on Electron 45 so far; WebdriverIO is the spec's fallback.

## 2026-10-29 · M2: `TDC_USER_DATA_DIR` for test isolation

- **Decision:** when the app is not packaged, `TDC_USER_DATA_DIR` overrides `userData` before the single-instance lock is taken.
- **Reason:** e2e runs (and later settings-restart tests) must not share a lock or settings with a real install. Ignored in packaged builds, so it isn't an attack surface for shipped apps.

## 2026-10-30 · Add `@tdc/kernel` and dependency rule 8 (changes the spec's layout)

- **Decision:** a new `packages/kernel` holds cross-cutting types every non-UI package needs: `Logger`, `Clock`, and later the typed emitter, `Service` lifecycle, backoff, rate limiter and error base types. **Rule 8:** kernel imports nothing from the workspace, no runtime APIs (Node, DOM, Electron) and at most the validation library. `core`, `api`, `storage`, `config` and main may import it; `ui`, the renderer, preload and `ipc-contract` may not.
- **Alternatives:** define `Logger`/`Clock` in `core` (but `api`, `storage` and `config` can't import `core` under rule 2); duplicate the interfaces in each package.
- **Reason:** the service and factory architecture in `docs/port-plan.md` injects a logger and clock into every service. Enforced by `tooling/eslint/boundaries.mjs`, `yarn.config.cjs` and new cases in `tooling/eslint/boundaries.test.ts`. `docs/spec.md` is left as written; this entry supersedes its layout and dependency rules where they differ.

## 2026-10-30 · Port approach: rewrite TwitchDropsMiner in our architecture

- **Decision:** a TypeScript rewrite in our service architecture, using their behaviour and protocol details as-is wherever that's simply how Twitch has to be called.
- **Reason:** it's a different language and structure, so there's no code to carry over and no notice to maintain.

## 2026-10-30 · Port plan decisions 2–5

- **Login:** `AuthStrategy` with a login-window and a device-code implementation; both get tested live in M7, and whichever works becomes the default.
- **Realtime:** PubSub sits behind a `RealtimeSource` interface so polling can replace it.
- **Offline:** a `Connectivity` service pauses the miner; on resume it re-validates auth and reloads the full inventory.
- **Scope of v1:** full feature parity, including the image cache, in a temporary React UI (`docs/port-plan.md` §5). English only, with strings kept in one module. The UX redesign and our own translations come later.

## 2026-10-30 · Milestone order with the port

- **Decision:** M3 IPC (contract built around a `MinerSnapshot` view model plus commands), M4 config (their settings), M5 storage (campaign cache, claim history, image cache), M6 network (`api`: HTTP, GQL, PubSub, watch, tested against scrubbed fixtures), M7 auth (both strategies, tested live). Then a **new M7b "Miner"**: `core` domain rules written tests-first from `docs/port-plan.md` §3, then the services, then the miner state machine, wired into the temporary UI. M8–M12 continue as in the spec, with M8 also covering connectivity pause/resume.
- **Reason:** the spec's infrastructure milestones become the pieces the miner needs, so the port lands on finished foundations.

## 2026-10-30 · M3: hand-written typed IPC on a shared zod contract

- **Decision:** `@tdc/ipc-contract` defines each request channel once (`invokeChannels`: input and output zod schemas). Main has one validating router (`apps/desktop/src/main/ipc/router.ts`, no Electron imports) behind a thin `ipcMain.handle` binding. The router checks, in order: the channel is in the contract, the sender frame's URL is the app's renderer origin, the input parses, and the handler's output parses. Main replies with an `IpcResult` envelope (`{ ok, value }` or `{ ok: false, error: { code, message, issues? } }`); handler exceptions are logged in main and reach the renderer only as `HANDLER_FAILED`. The preload exposes just `window.api.invoke(channel, input)` with a contract-channel allowlist. The renderer's `invoke()` unwraps the envelope and throws `IpcError`, and data goes through TanStack Query.
- **Alternatives:** `electron-trpc` (1.0.0 published 2026-10-30, too new, and adds tRPC client and server); `@egoist/tipc` (maintained, but peers on React Query and has its own router conventions); `@electron-toolkit/typed-ipc` (needs `@electron-toolkit/preload`, which exposes `ipcRenderer`); `electron-typescript-ipc` and `interprocess` (no releases since 2022–2023).
- **Reason:** about 150 lines that we fully control, with sender validation (Electron security checklist item 17), and nothing extra in the preload. Errors use an envelope because `Error` subclasses lose their fields crossing `contextBridge`.
- **Channels so far:** `app:getInfo` and `shell:openExternal` (https only). Main → renderer push events come in M8.
- **Tests:** `router.test.ts` covers valid calls, five invalid payloads, input on a no-input channel, untrusted and destroyed senders, unknown channels (including `__proto__`), hidden handler errors and invalid output. With input validation disabled, 6 of them fail. `e2e/tests/ipc.spec.ts` sends an invalid payload from the real renderer and gets `INVALID_INPUT`.
- **Also:** `apps/desktop/src/main/logger.ts` is a console implementation of the kernel `Logger` until electron-log arrives in M9, and `productName` is set in `apps/desktop/package.json` so `app.getName()` returns "Twitch Drop Collector".

## 2026-10-30 · M4: settings stored as a JSON file, not electron-store

- **Decision:** `@tdc/config` owns the zod schema, defaults, migrations and `createSettingsService({ store, logger })`. Main implements `SettingsStore` as `userData/settings.json`, written atomically (temp file, then rename). A file that isn't valid JSON is moved aside as `settings.json.corrupt-<time>` and the app starts from defaults. The file holds `{ version, settings }`, and migrations run step by step from the file's version.
- **Alternatives:** electron-store 12 (spec default).
- **Reason:** electron-store 12 and `conf` 16 are ESM-only while our main process builds as CommonJS. They validate with ajv JSON Schema, a second schema system next to zod, and tie migrations to semver. electron-store also imports `electron`, so it couldn't live in `@tdc/config`. The spec lists a small JSON file wrapper as the alternative.
- **Loading is lenient, updates are strict.** On load, each invalid or missing field falls back to its own default, and the repaired file is rewritten once with a warning, so one bad value never resets everything. Updates are partial patches validated strictly (unknown keys rejected), written in call order, and only then applied and broadcast to subscribers.

## 2026-10-30 · M4: settings reach the renderer through a mirrored transport schema

- **Decision:** `@tdc/ipc-contract` has its own `SettingsView` and `SettingsPatchInput`, a copy of config's schema. `apps/desktop/src/main/ipc/settings-contract.test.ts` asserts the types are equal (`expectTypeOf`, enforced by typecheck) and that both accept and reject the same sample values.
- **Alternatives:** let `ipc-contract` or the renderer import `@tdc/config`.
- **Reason:** that would break fixed dependency rules 4 and 7. The duplication is small, and the test turns drift into a build failure.

## 2026-10-30 · M4: launch at login

- **Decision:** a `LoginItem` adapter in main. On Windows it calls `app.setLoginItemSettings({ openAtLogin, args: ['--autostart'] })`; on macOS, `app.setLoginItemSettings({ openAtLogin })` (SMAppService), with `wasOpenedAtLogin` to detect login launches. On Linux it writes `$XDG_CONFIG_HOME/autostart/twitch-drop-collector.desktop` (default `~/.config`), whose `Exec` uses `$APPIMAGE` when set, quoted per the Desktop Entry spec, and removes it when disabled. The setting is the source of truth and is re-applied at every launch. Unpackaged builds never register, because they would register the bare Electron binary.
- **Start minimised:** applies only to login launches. Until the tray exists (M8) it means minimised to the taskbar.
- **Not yet verified:** real registration on each OS needs packaged builds (M10). Unit tests cover the calls and the files written for all three platforms.
- **Also:** the `theme` setting drives `nativeTheme.themeSource`, so `system`/`light`/`dark` flows into the renderer's `color-scheme`. The `logging.level` setting drives the main logger, except in dev, which always uses debug. `proxy` and `connectionQuality` are stored now and used from M6.

## 2026-10-30 · M4: temporary renderer structure

- **Decision:** two tabs (Main, Settings) as plain component state, with no router yet; UI text lives in `src/renderer/src/strings.ts`.
- **Reason:** the UI is temporary (port plan §5), so the router choice waits for the real UI design. One strings module makes i18n a drop-in later.

## 2026-10-30 · E2E windows are invisible by default

- **Decision:** with `TDC_E2E_INVISIBLE=1` (set by the e2e helper, ignored in packaged builds), windows open with `opacity: 0`, `focusable: false` and `skipTaskbar: true`. They still render and take Playwright input, but never appear on screen or steal focus. Set `TDC_E2E_SHOW_WINDOWS=1` to watch a run. A test asserts the window really is transparent and unfocusable.
- **Limits:** Linux ignores `opacity`, but Linux CI runs under `xvfb-run` (spec), which is off-screen anyway.

## 2026-10-30 · M5: node:sqlite with plain SQL, not better-sqlite3 + Drizzle (chosen by Kyle)

- **Decision:** Node's built-in `node:sqlite` behind a small `Database` interface (`exec`, `run`, `get`, `all`, `transaction`, `close`) in `@tdc/storage`. Repositories are written in plain parameterised SQL, cached reads are validated with zod, and migrations are numbered SQL strings tracked with `PRAGMA user_version`, each applied in its own transaction. Tables are `STRICT`. The connection uses WAL, `synchronous = NORMAL`, foreign keys and a 5s busy timeout.
- **Alternatives:** better-sqlite3 + Drizzle (spec default); node:sqlite + Drizzle through `sqlite-proxy`; Kysely.
- **Reason:** `node:sqlite` ships inside Electron 45 (Node 24.22.1, SQLite 3.53.4, the same SQLite as our dev Node 24.22.2) and has been a release candidate (stability 1.2) since Node 24.15. With no native module, the spec's native-module pitfalls disappear: no rebuild for Electron's ABI, no `.node` unpacking from asar, no per-arch prebuilds in M10, and no special Vitest setup. Drizzle 0.45.x has no `node:sqlite` driver (only the 1.0 betas do). Our schema is small enough that plain SQL stays readable. Drizzle's CVE-2026-39356 is fixed in 0.45.2, so it remains an option if the schema grows.
- **Risk:** the API isn't marked stable yet. Everything goes through `Database`, so switching engines touches one file.
- **Recovery:** a database that can't be opened or migrated (corrupt, or from a newer app version) is renamed to `tdc.db.unusable-<time>` along with its `-wal`/`-shm` files, and a fresh one is created. It only holds rebuildable cache and history. `openSqlite` closes its handle when setup fails, because Windows can't rename an open file; a test caught this.
- **Schema v1:** `cache_entries` (namespace, key, JSON value, `expires_at`) and `claims` (claimed drops). Main purges expired cache entries at startup and hourly, and closes the database on `will-quit`. The image-cache index waits until the image protocol is built (M7b), as its own migration.
- **Tests run twice:** `yarn test` runs them in plain Node, and `yarn test:electron` runs the storage suite inside Electron's runtime (`tooling/scripts/vitest-in-electron.mjs`, `ELECTRON_RUN_AS_NODE`). A guard test proves the second run really is Electron. `yarn check` includes both. The e2e suite checks that the real app creates and migrates `tdc.db`. Running these on all three OSes is part of CI in M11.

## 2026-10-30 · M6: network layer in @tdc/api

- **GQL schema source (spec open decision): hand-written zod, chosen by Kyle.** Twitch publishes no schema and turns off introspection, and the operations are persisted queries (name plus sha256 hash, no query text). Each operation in `packages/api/src/gql/operations.ts` has its hash, typed variables and a `looseObject` schema covering only the fields we read. Extra fields are allowed; a missing or changed field we rely on throws `ResponseShapeError`. The schemas come from how TwitchDropsMiner reads the responses and **haven't been checked against live Twitch yet**; M7 captures real responses (with tokens and IDs scrubbed) as fixtures.
  - **Alternatives:** graphql-codegen against an unofficial schema dump (stale, unofficial, no runtime validation).
- **HTTP:** `createHttpClient({ fetch, userAgent, timeoutMs, scheduler, logger })`. Bodies are read in full. Connection errors, per-attempt timeouts and 5xx are retried with backoff (base 2, ±10% jitter, 3-minute ceiling) until the caller's `AbortSignal` aborts or `maxAttempts` is reached; 4xx are returned to the caller. The timeout is read on every attempt: `10s × connectionQuality`.
- **GQL:** batches of up to 20 per request, behind a rate limiter of 5 requests per 1s window (upstream's "do not modify" value). Error rules: retry `service error` and `PersistedQueryNotFound` once after at least 5s; retry `service timeout`, `request cancelled`, `service unavailable` and `context deadline exceeded` with backoff (60s ceiling, 8 attempts); on `server error`, null out the errored path and validate the rest; anything else throws `GqlError`. Auth headers come from an injected `GqlAuth` (implemented in M7).
- **PubSub:** `RealtimeSource` implemented by a pool of up to 8 WebSockets with 50 topics each. LISTEN/UNLISTEN go out in chunks of 20 with the access token. It pings every 3 minutes, and if no PONG arrives within 10s it reconnects. It also reconnects on `RECONNECT` or a dropped socket, with backoff, and re-listens to all topics. A socket closes when its last topic goes away. The WebSocket factory is injected (Node's global `WebSocket` in main and tests).
- **Watching:** `createHlsWatcher`: PlaybackAccessToken, then the usher master playlist (last variant, normally the lowest quality), then the media playlist, then HEAD on every segment. The variant URL is cached per channel and dropped when it stops working. Relative playlist entries are resolved (upstream only followed absolute ones). The spade and GQL `sendSpadeEvents` methods aren't ported.
- **Kernel additions:** `createBackoff`, `createRateLimiter` (FIFO, start-rate and concurrency caps), `Scheduler`/`AbortError`/`AbortSignalLike`, `createEmitter`, and `@tdc/kernel/testing` (`createManualTime`). Kernel holds no timers; `systemScheduler` lives in `@tdc/api`.
- **Main:** `createNetFetch(net)` is the `FetchLike` (system proxy and certificate store). The `proxy` setting is applied with `session.defaultSession.setProxy`: empty means `mode: 'system'`, otherwise `fixed_servers` with `scheme://host:port` (Electron's proxy rules don't take credentials). Clients are built in M7, once auth can supply tokens. An e2e test proves `net.fetch` passes our `User-Agent`, `Client-Id` and body through unchanged, and that main has `WebSocket` and `AbortSignal.any`.
- **Known limitation:** Node's `WebSocket` doesn't use Electron's proxy, so PubSub ignores the proxy setting. If that matters, the `RealtimeSource` polling fallback or a proxy-aware WebSocket can replace it.
- **Tests:** against real local servers. HTTP and GQL use `node:http`; PubSub uses a `ws` server playing Twitch's side (devDependency of `@tdc/api` only). The PubSub suite passed five runs in a row.

## 2026-10-30 · Lint: explicit-module-boundary-types instead of explicit-function-return-type

- **Decision:** require types on exported function signatures, not on every function.
- **Reason:** the stricter rule flagged methods inside objects whose type is already declared (`createX(): X { return { get() {…} } }`), where TypeScript already checks every return type against `X`. This is a style rule, not one of the dependency-boundary rules.
