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

## 2026-10-30 · Client identity: follow TwitchDropsMiner (chosen by Kyle)

- **Decision:** present as Twitch's Android app (`CLIENT_PROFILES.androidApp`: its client ID and Dalvik user agents), the same as TwitchDropsMiner `dev-build`, for login, GQL and watching. If upstream switches profiles later, we follow.
- **Alternatives:** register our own Twitch application (official API only, which has no drops endpoints); the web client ID.
- **Reason:** upstream's author has researched which client works for drops and maintains it in contact with Twitch staff. Presenting as Twitch's own app is against Twitch's terms and carries a risk of the account being flagged; Kyle accepts that for this personal tool.

## 2026-10-30 · M7: auth

- **Service:** `createAuthService` in `@tdc/core` owns the session. It handles restore and re-validation at startup, both sign-in strategies, cancel, sign-out, `invalidate()` (for a later GQL 401), the GQL auth headers (`Authorization: OAuth …`, a per-run `Client-Session-Id`, a persistent `X-Device-Id`) and the PubSub token. `AuthState` holds user ID and login, never a token. Secret storage and the login window are ports implemented in main.
- **Sign-in strategies:**
  - **Login window:** Twitch's login page in a `BrowserWindow` on its own persistent partition (`persist:twitch-login`), with no preload and our secure web preferences. Its permission requests are denied, and its user agent is Electron's minus the Electron/app tokens. The login URL matches upstream's Android-client URL (double-encoded `redirect_params`). The token comes from the `#access_token=` redirect on the web origin; the window then closes, and closing it yourself cancels. This window may navigate to `https://*.twitch.tv` (through a per-webContents allowance in `security.ts`); the renderer's rules are unchanged.
  - **Device code:** id.twitch.tv `/oauth2/device` then `/oauth2/token`, polling at Twitch's interval. `slow_down` adds 5s, an expired code is replaced automatically, and `access_denied` ends the sign-in. The code and activate link show in the UI.
  - Which one becomes the default depends on the live check.
- **Spec open decision, sign-in redirect method:** neither a custom protocol nor a loopback server. The login window reads the redirect URL directly.
- **Tokens at rest (deviation from the spec's "access tokens stay in memory"):** Twitch's implicit-flow and Android-client tokens are long-lived access tokens with no refresh token, so the access token is the long-lived secret. It's stored together with user ID, login, client ID and device ID as one `safeStorage`-encrypted blob in `userData/session.bin`, written atomically. A blob that can't be decrypted is deleted.
- **Linux without a keyring (spec open decision): don't persist.** With `getSelectedStorageBackend() === 'basic_text'` the session stays in memory only, and the user signs in each launch.
- **Startup:** `auth.start()` runs after the window opens. If Twitch is unreachable within 30s, the saved session is kept as `signedIn` with `verified: false`. A token Twitch rejects, or one issued to a different client ID, is deleted and the user is asked to sign in again.
- **Sign-out:** clears the in-memory token, `session.bin` and the login partition's storage, so the next sign-in asks for credentials.
- **Electron's `net.fetch` refuses custom `Origin` and `Referer` headers** (`net::ERR_FAILED` and `net::ERR_BLOCKED_BY_CLIENT`), and Twitch's clients (and upstream) send both on GQL and identity calls. `session.webRequest` doesn't see main-process `net.fetch` requests, so it can't add them either. `createNetFetch` is now built on `net.request`, which accepts Origin as its `origin` option and Referer once `referrerPolicy: 'unsafe-url'` is set. It's the same network stack, so the spec's intent (system proxy and certificate store) holds; session cookies aren't sent. Found by the e2e device-code test. `e2e/tests/network.spec.ts` asserts that `net.fetch` still refuses them, so a future Electron that allows them gets noticed.
- **E2E:** `e2e/tests/mock-twitch.ts` serves the login redirect, `/oauth2/validate`, `/oauth2/device` and `/oauth2/token`, and requires Origin and Referer on identity calls. `auth.spec.ts` covers:
  - login-window sign-in, with the token absent from every IPC reply, the DOM, cookies and web storage, and absent in plain text from `session.bin`
  - restore after a restart, then sign-out clearing `session.bin` and the login cookies
  - device-code sign-in
  - a revoked token at startup
- **Test isolation:** dev builds read `TDC_TWITCH_ENDPOINTS` (JSON; ignored when packaged). The e2e helper points every endpoint at a closed local port unless a test supplies a mock, so no test reaches the real Twitch.

## 2026-10-30 · M7 live check: device codes need the Android TV client; login window gets an address bar

- **What we found live:** the login window signed in with the Android app client (Kyle's account). Device code with the Android app client fails with `400 invalid client`, which explains why upstream's device-code function is unused. An anonymous probe showed Twitch _does_ issue device codes to the Android TV client (`ue6666qo983tsx6so1t0vnawi233wa`, from upstream's client list).
- **Decision (Kyle): keep device code, using the Android TV client.**
  - A session now belongs to the client its token was issued to: login window means the Android app, device code means the Android TV app.
  - `StoredSession.clientId` picks the profile on restore, and a saved session for an unknown client is discarded.
  - `GqlAuth.headers()` now carries the full client identity (`Client-Id`, `Origin`, `Referer`, `User-Agent`), so the GQL client no longer holds a profile.
  - The identity client sends its profile's user agent.
- **Open:** whether Twitch counts drops for Android TV client tokens is only known once the miner runs (M7b). The login window stays the primary method.
- **Activation link:** the Android TV client's `verification_uri` comes back without the code, so `activationUrl()` adds `?device-code=<code>` when missing. The "Open twitch.tv/activate" button then opens your browser with the code already filled in (Kyle's suggestion).
- **Why not your own browser for the main sign-in:** with the Android app client, the token only comes back on a redirect to `https://www.twitch.tv/#access_token=…`, which an app can't read from your browser. Twitch won't redirect to `localhost` or a custom protocol for a client we don't own, and a Twitch app we register ourselves gets tokens that can't collect drops. Device code is the browser-based option.
- **Login window trust (Kyle: mini browser bar):** the window is a `BaseWindow` with two `WebContentsView`s.
  - The top one is our own address bar: static HTML from a `data:` URL, JavaScript off, its own in-memory partition, CSP `default-src 'none'`. It shows the live host and path (never the query or `#…`, so the token never appears), plus "Secure connection" for https or "Not secure" otherwise.
  - The window title is "Sign in to Twitch (host)".
  - The account panel explains each method before you start: what opens, to check for 🔒 www.twitch.tv, and that your password goes only to Twitch.
  - Both views' webContents are closed with the window.
- **Login window follow-ups (Kyle):**
  - **Address bar restyled** like a browser's read-only field: muted fill, a 6px radius, the lock (or a red "Not secure" chip) inside the field on the left, host and path with no gap between them. The line height was fixed so descenders aren't clipped.
  - **Window locked down:** it isn't resizable, maximizable or fullscreenable, and has no menu.
  - **No DevTools:** both views have `devTools: false`.
  - **No zoom:** Electron only zooms through menu items (Ctrl+wheel just emits `zoom-changed`), so with no window menu there's no zoom path on Windows or Linux. `before-input-event` blocks the zoom and DevTools shortcuts, which also covers macOS's global app menu, and pinch zoom is pinned to 1.
  - **Tests:** e2e checks the window flags and that `openDevTools()` does nothing (it fails when the protections are removed). Unit tests cover the blocked and allowed shortcuts. An e2e Ctrl+wheel zoom check was dropped because it passed even without protection, so it proved nothing.
- **Live re-check (Kyle, 2026-10-30): both sign-in methods work against real Twitch.** The login window signs in as the Android app; the code flow signs in as the Android TV app, with the code pre-filled on twitch.tv/activate. Kyle notes that, historically, the Android TV client is the one with access to the campaign and drop GQL queries; to be confirmed when the miner first fetches the inventory (M7b).
- **Code sign-in is the only visible method (Kyle, 2026-10-30).** The account panel shows a single "Sign in with Twitch" button that runs the device-code flow (Android TV client), with the code pre-filled on twitch.tv/activate. The login-window strategy stays in core and main, reachable only through `auth:signIn { method: 'loginWindow' }`, so it can be tested later. Its e2e tests start it through IPC.
- **safeStorage moved to the async API.** The sync `isEncryptionAvailable` / `encryptString` / `decryptString` are deprecated in Electron 45 and logged warnings at startup. The session store uses `isAsyncEncryptionAvailable`, `encryptStringAsync` and `decryptStringAsync`, is created asynchronously once the app is ready, and re-saves the session when decryption reports `shouldReEncrypt` (the OS key rotated). Data written with the old API still decrypts with the new one (Electron docs).

## 2026-10-30 · M7b live probe: the Android TV session can't see campaigns

- **How:** a dev-only probe (`apps/desktop/src/main/dev/gql-probe.ts`, `TDC_DEV_GQL_PROBE=1`, ignored when packaged) runs only read-only GQL queries on a saved session and saves the raw responses under `userData/gql-probe/`. It ran on a copy of Kyle's Android TV session. Windows `safeStorage` needs the profile's `Local State` file as well as `session.bin`.
- **Results for the Android TV session:** every query returned HTTP 200 with no GQL errors, and every response matched our schemas, but:
  - `Inventory` ✅ full data for in-progress campaigns (7) and claimed rewards (904).
  - `ViewerDropsDashboard` (campaign list) ❌ `currentUser.dropCampaigns: null`, with or without `fetchRewardCampaigns`.
  - `DropCampaignDetails` ❌ `dropCampaign: null`, keyed by login or by user ID. (Upstream passes the user ID as `channelLogin`; `CampaignDetailsQuery` should follow that.)
  - `DirectoryPage_Game`, `VideoPlayerStreamInfoOverlayChannel`, `DropsHighlightService_AvailableDrops`, `DropCurrentSessionContext` and `PlaybackAccessToken` ✅.
  - `AvailableDrops` includes campaign name, game, end time and drops with benefits for live channels, but no account-link status, allow-list or start/status.
- **Meaning:** an Android TV session can watch and progress drops, but can't discover campaigns you haven't started. That's likely why upstream signs in as the Android app instead. Next step: probe an Android app session (login window) before choosing the sign-in method for good.
- **Android app session probe (Kyle signed in through the login window, separate scratch profile), 2026-10-30:** `ViewerDropsDashboard` returns 141 campaigns (120 active, 21 expired). `DropCampaignDetails` returns full data, including allow-lists (e.g. 37 channels) and the per-campaign `self.isAccountConnected`, **when `channelLogin` is the user ID** (`user: null` with the login, for either client). Inventory and every channel/watch query work as they did for the Android TV session.
  - **Conclusion:** only the Android app client (login window) can discover campaigns, as upstream does. An Android TV (device-code) session can only progress campaigns already in your inventory.
  - **Fix:** `CampaignDetailsQuery` now takes `{ campaignId, userId }` and sends the ID as `channelLogin`.
  - **Clean-up:** the copied `session.bin` files in the scratch probe profiles were deleted afterwards. The raw responses stay in the scratchpad, to be scrubbed into fixtures.
- **Sign-in follows upstream (Kyle: "do whatever the other miner does"), 2026-10-30:** the login window (Android app client) is the only visible method, under "Sign in with Twitch". The device-code strategy (Android TV client) stays in core and main, reachable through `auth:signIn { method: 'deviceCode' }`, with its e2e test starting it through IPC. This supersedes the earlier "code sign-in is the only visible method" entry.

## 2026-10-30 · M7b: live fixtures and the GQL → domain mapping

- **Fixtures:** `packages/api/fixtures/twitch/*.json`, exported as `@tdc/api/fixtures/*`. They're real Android app session responses from the probe, anonymised by a scrub script kept outside the repo. User ID → `10000001` (also inside `dropInstanceID`s), login → `test_user`, request IDs → `REQUEST`, long lists trimmed. The scrub refuses to write anything still containing the user ID, login or an IP-like value. The playback token response is excluded (signed credential with an IP). `live-fixtures.test.ts` parses every fixture with our schemas and asserts the facts we rely on.
- **What the live data showed:**
  - Detail responses have no box art and no per-drop progress (`self`).
  - Campaign-list entries carry box art and `self.isAccountConnected`.
  - Inventory entries carry progress and `dropInstanceID`.
  - Some allow-list channels have no display name.
- **Mapping (`packages/core/src/inventory/mapping.ts`):** as upstream, campaign data is merged in layers (`mergeRaw`): inventory over campaign-list entry over details. A nested object merges; a list is taken whole from the higher layer.
  - The merged object is validated with `gql.CampaignDetails`, then converted.
  - The campaigns built are those in progress plus those with details. Campaigns without a game are skipped; ones that don't validate are skipped and reported.
  - Without progress data, a drop counts as claimed when all its awarded rewards (`gameEventDrops.lastAwardedAt`) fall inside the drop's window.
  - Claimed drops count as complete.
  - Box art URLs lose their `-WxH` size suffix.
  - Unknown benefit types map to `UNKNOWN`, unknown statuses to `ACTIVE`.
- **Domain rules:**
  - A precondition drop that isn't in the campaign doesn't block (upstream would crash on it).
  - Progress updates apply the same change to every drop in the campaign, clamped to each drop's required minutes.

## 2026-10-30 · M7b: inventory, channel and watch services

- **Inventory (`createInventoryService`):**
  - `refresh()` fetches `Inventory`, then `ViewerDropsDashboard`, then `DropCampaignDetails` (batched 20 at a time, by user ID) for active and upcoming list entries, and builds campaigns with the mapping. If the campaign list is missing (an Android TV session), it warns and keeps the in-progress campaigns.
  - It also handles progress updates, estimated minutes and late claim IDs.
  - `claim()` calls `ClaimDrop` and treats `ELIGIBLE_FOR_ALL` or `DROP_INSTANCE_ALREADY_CLAIMED` as success, then marks the drop claimed and records it in the storage claim history. Other answers or GQL errors leave the drop unclaimed.
  - `claimAll()` claims every claimable drop in non-upcoming campaigns. The live inventory had three finished but unclaimed Crimson Desert drops, which the test now covers.
- **Channels (`createChannelService`):**
  - `refresh()` covers wanted, earnable-within-the-hour campaigns. Allow-listed channels are checked live in bulk (`StreamInfo`, batched), and offline ones are kept but rank last. Games without allow-lists get live, drops-enabled streams from `DirectoryPage_Game` (20 per game). Channel ID is the broadcaster's ID, not the stream's.
  - Results are ranked and capped at 199.
  - With the available-drops check on, a live channel counts as drops-enabled only if `AvailableDrops` lists a campaign we could earn there.
  - `updateStream`, `setOffline` and `setViewers` apply live events.
  - Directory slugs are built from the game name when Twitch gave none.
- **Watch (`createWatchService`):** one watch every 20s on the target channel. A progress-check event fires about 15s after each watch, if the target hasn't changed. A new target or `restart()` (after a claim) cuts the wait short. Failed watches are reported and the loop continues. Tested on the manual clock.
- **Test support:** `fakeGql` answers operations by name and validates every answer with the operation's schema, so fakes can't drift from the real response shapes. The services are tested on the live fixtures.

## 2026-10-30 · M7b: the miner

- **`createMiner` (`packages/core/src/miner/miner.ts`)** ports upstream's main loop. It's event-driven: its own actions (reload, games update, channel switch, claim, stream re-check, progress check) run one at a time through a queue, which replaces upstream's state-flag loop. Every decision uses the tested pure rules.
- **Reload:** inventory refresh, `claimAll` (each claim announced through `onClaim`), wanted games, channel refresh, PubSub topic sync for tracked channels, channel pick, and maintenance timers (campaign and drop windows within the hour, plus an hourly full reload).
- **Live events:**
  - `drop-progress` updates a drop that can be earned on the watched channel.
  - `drop-claim` records the claim ID and claims. After 4s it polls `CurrentDrop` up to 8 times, 2s apart, until Twitch moves on, then restarts watching, or reloads if the campaign is done on this channel.
  - `stream-down` takes effect at once. `stream-up` and `broadcast-settings-update` re-fetch after 120s.
  - `viewcount` updates viewers.
  - Reward notifications trigger a reload, and the notification is dismissed.
  - A failed watch re-checks the channel.
- **Progress:** when Twitch has reported nothing for 60s, the miner asks `CurrentDrop`. If that has nothing, it adds one estimated minute to the active campaign, and at the 15-minute cap it switches channel.
- **Other:** a manual channel choice wins while it's watchable. A failed task sets status `error` and retries a reload after 5 minutes. `stop()` unsubscribes everything and stops watching. The UI reads `snapshot()`: status, message, watched channel, active campaign and drop, and wanted games.
- **Tests:** 15 scenarios with in-memory service fakes, a fake PubSub and the manual clock.

## 2026-10-30 · M7b: wiring the miner into the app

- **Main → renderer events:** the contract gains `eventChannels` (`auth:state`, `miner:state`), each with a zod schema. `createEventPublisher` validates every payload before `webContents.send`, so a broken or over-full payload (a token, say) never reaches the window. The preload's `window.api.on` forwards only contract events and passes only the payload, never the IPC event object. `miner:state` is throttled to one send per 250 ms.
- **IPC:** `miner:getState`, `miner:reload` (queued; returns at once) and `miner:selectChannel` (an ID, or none to let the miner choose).
- **Mining runtime (`apps/desktop/src/main/miner/runtime.ts`):** the composition root for mining. It builds the GQL client (5 requests per second), PubSub, HLS watcher and the inventory, channel and watch services, then the miner. The miner starts on sign-in and stops on sign-out; changing mining settings calls `refreshGames`. Claims show a system notification when `trayNotifications` is on. `before-quit` stops it.
- **Views (`views.ts`):** main turns domain objects into plain view objects (dates as ISO strings, shown minutes capped at the requirement, campaigns sorted active, upcoming, then ended). The renderer never sees domain types.
- **Probe mode:** with `TDC_DEV_GQL_PROBE` set (dev builds only), mining doesn't start, so the read-only probe never claims anything.
- **Renderer:** `useLive` loads state once over IPC and then follows the events through TanStack Query's cache, which replaces the auth polling. The temporary UI gains a Mining panel on the Main tab (status, watched channel, active drop progress, wanted games, reload, channel table with manual choice) and an Inventory tab (campaigns with state, dates, account link and drops).
- **E2E:** the mock Twitch answers GQL from the anonymised fixtures, requires a valid token, and records operations and claims. The test signs in, waits for the miner to go idle, checks that the three finished Crimson Desert drops were claimed, and checks the Inventory tab.
- **Not yet:** a GQL 401 doesn't invalidate the session yet, PubSub ignores the proxy setting, and images aren't shown (the image cache comes with M10).

## 2026-10-30 · M7b: fixes from the first live run

- **Endless waits spun.** `setTimeout` turns delays above 2^31−1 ms (Infinity included) into 1 ms, so the idle watch loop's "wait until woken" fired constantly. `systemScheduler.sleep` now sets no timer for Infinity (only an abort ends it) and chains timers for longer finite delays. The kernel `Scheduler` contract says so.
- **Claims only for connected game accounts.** Twitch answered `ELIGIBLE_FOR_ALL` to claims for a game account that isn't connected, yet kept listing the drops unclaimed, so every reload claimed and announced them again. We now claim only when the campaign's account is connected (badge and emote campaigns need no connection). A finished drop waiting for a connection shows "Ready to claim: connect your game account…" in the UI (`DropView.awaitsConnection`), and the user claims it on Twitch after connecting. That way Twitch never sees automatic claims that can't succeed.
- **Each claim is asked once per run.** If Twitch confirms a claim but still lists the drop unclaimed, we don't ask again until the next start. `DROP_INSTANCE_ALREADY_CLAIMED` marks the drop claimed without recording or announcing a new claim. The claim log includes Twitch's status.
- **Saved sessions log their client** on restore, which showed the live session was an Android TV one (no campaign list).

## 2026-10-30 · No passkeys in the app

- Twitch's sign-in page offers passkeys, and inside Electron on Windows that opens a Windows Security (Windows Hello) dialog. Electron has no per-window setting for WebAuthn, so main starts Chromium with `--disable-blink-features=WebAuth`. Pages then have no `PublicKeyCredential`, and Twitch's page falls back to username and password. Our own renderer doesn't use WebAuthn, so the app-wide switch costs nothing. Checked with a probe (`PublicKeyCredential` is gone, even in a secure context; the `WebAuthentication` name does nothing) and in the login-window e2e test.

## 2026-10-30 · Claims read Twitch's account-link error

- A claim the user's browser made for the unlinked Crimson Desert account came back with `status: ELIGIBLE_FOR_ALL`, but also `isUserAccountConnected: false` and `error.code: ACCOUNT_LINK_REQUIRED`. Twitch's campaign data still called that account connected. The link is checked on the publisher's side, so only the claim answer shows the problem.
- `ClaimDrop` now uses twitch.tv's current persisted query (`3b8a08f5…`), which returns those fields; upstream's older one (`a455deea…`) answers with `status` only. Both hashes are still known to Twitch: checked without a token or claim input, so nothing was claimed (a made-up hash returns `PersistedQueryNotFound`).
- `ACCOUNT_LINK_REQUIRED` or `isUserAccountConnected: false`: the drop stays unclaimed, nothing is recorded or announced, and the campaign counts as not linked for the rest of the run, so it isn't asked again and the UI shows "Ready to claim: connect your game account…". Any other `error` is a failed claim.

## 2026-10-30 · M8: tray, close to tray, pause and resume

- **Tray (`apps/desktop/src/main/shell/`):** one tray icon, the app icon with a coloured status badge (blue loading, grey idle, green mining, red problem, amber paused; plain when stopped). Badges are painted onto the icon's bitmap at 2x, not shipped as extra image files. The tooltip and a disabled first menu line show the status ("Mining Rust on Streamer · 35/60 min"). The menu has Show/Hide window, Reload campaigns (only while the miner runs) and Quit. Clicking the icon shows or hides the window on Windows and macOS; on Linux the menu is the way in, because desktops treat clicks differently. A pure `trayContent()` decides the content, and the adapter only renders it (and skips renders when nothing changed). macOS template images are left for the UI revamp.
- **Close to tray:** a new `general.closeToTray` setting, on by default, because a miner is meant to keep running. Closing the window hides it; Quit from the tray (or quitting the app) really quits. "Start minimised when started at login" now starts in the tray. If there's no tray, closing quits as before. Invisible e2e runs create no tray, so tests don't put an icon on the developer's taskbar; those runs act as if it existed.
- **Connectivity (`packages/core/src/connectivity`):** online, offline or asleep. `net.isOnline()` is checked every 5s (Electron documents only its `false` as reliable, so it's used to detect going offline). `powerMonitor` suspend/resume covers sleep. While not online, the mining runtime stops the miner and the view says `paused` with the reason. Back online, it re-validates the saved session first, then starts the miner fresh (a full reload), as the port plan decided. Failed-request signals aren't used yet; a dead network that `net.isOnline()` misses still shows up as request errors and the miner's retry.
- **Tests:** tray content and the badge painter are unit-tested; e2e covers hiding on close, quitting when the setting is off, and pause/resume via emitted `powerMonitor` events against the mock Twitch.

## 2026-10-30 · M9: logging and crash reports

- **electron-log 5 (`electron-log/main`) in main only.** `createAppLogger` implements the kernel `Logger` on it: one file, `<profile>/logs/main.log`, rotated at 5 MB (electron-log keeps one `main.old.log`), lines `[time] [level] [scope] message {fields}`, and the console in development. The level follows the logging setting. We never call `log.initialize()`: that bridges the renderer to the logger through a preload API, and our window gets nothing beyond the typed contract.
- **Errors from every process:** `watchProcesses` logs main's uncaught exceptions and unhandled rejections (with stacks); page and helper process crashes (`render-process-gone`, `child-process-gone`, page URLs without query or fragment); preload failures; unresponsive pages; and console errors printed by the app's own window, uncaught renderer errors included. Twitch's sign-in page reports only crashes, since its console isn't ours. A crashed app window is reloaded, at most once a minute.
- **Crash reports: local only, opt-in.** The user chose to keep dumps on the computer for now; an upload service can come later. A new `general.crashReports` setting, off by default, starts Electron's crash reporter with `uploadToServer: false` before any window opens, or when turned on. Electron can't stop the reporter once started, so turning it off takes effect at the next launch; the Settings screen says so. Dumps go to `<profile>/Crashpad`.
- **Settings screen:** the crash reports checkbox and an "Open logs folder" button. That's a new `app:openLogsFolder` channel, which opens a folder fixed by main; the renderer can't name a path.
- **Tests:** e2e forces an error in main and in the window and finds both in the log file. It kills the window's renderer and sees it logged and reloaded, and crashes the main process for real (`process.crash()`): no dump without consent, a dump with it. Killing a page process doesn't produce a dump, so it can't test consent.

## 2026-10-31 · M10: packaging, fuses and the image cache

- **Packaging (`apps/desktop/electron-builder.yml`):** only `out/**` and `resources/**` (plus the generated package.json) go into `app.asar`; source maps are left out. The packaged `package.json` is named `twitch-drop-collector`, because the workspace name (`@tdc/desktop`) broke the NSIS output path. Windows builds a one-click per-user NSIS installer; macOS dmg and Linux AppImage and deb are configured but can only be built on those platforms (M11's CI). `publish` is off until M11 picks the update host. The macOS camera, microphone and folder usage strings from the template are gone: the app asks for none of them.
- **No runtime dependencies to collect.** Everything, electron-log included, is bundled by electron-vite, and storage uses `node:sqlite` (M5), so there are no native modules. electron-builder finds no `node_modules` to copy, so whether it resolves `catalog:` ranges (spec, "Unverified") stays moot.
- **Fuses**, flipped by electron-builder's `electronFuses` before signing: `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` and `grantFileProtocolExtraPrivileges` are off. `enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar` and `enableCookieEncryption` are on. Cookie encryption is a one-way switch (it can't be turned off later without losing the cookie store); the only cookies are Twitch's in the sign-in partition. Asar integrity works on Windows and macOS, not Linux. Nothing forks with `ELECTRON_RUN_AS_NODE`; `yarn test:electron` uses the unfused `electron` package, not the packaged app.
- **Packaged smoke test (`yarn test:packaged`):** it builds the unpacked app, then `apps/desktop/scripts/smoke-packaged.mjs` checks three things. The fuses are as configured (read with `@electron/fuses`). The app starts on a fresh temporary profile (`--user-data-dir`, which the packaged app honours), migrates its database, and logs "Main window ready" with no errors. And on Windows and macOS, a copy with one byte of `app.asar` flipped refuses to start (on Windows it ends with 0x80000003). Playwright can't drive the packaged app, because it needs the inspect flags the fuse turns off, so the e2e suite keeps running against the dev build. For this test, `TDC_E2E_INVISIBLE` is now honoured in packaged builds too; it only changes how windows are shown. Passed on Windows; macOS and Linux run in M11's CI.
- **Image cache (upstream `cache.py`):** box art and reward images reach the renderer as `tdc-image://cache/?url=<remote>`. Main serves that scheme on the default session only, so the sign-in window's partition can't use it. It answers only for https URLs on `*.jtvnw.net` (Twitch's CDN), fetches over `net` (proxy setting applies), and accepts jpeg, png, gif, webp or avif up to 5 MB. Files live in `<profile>/images`, named by the SHA-256 of their URL. The index is in the database (migration 2, `images`). Images unused for 30 days are evicted, then the least recently shown while the folder is over 200 MB. A URL that failed isn't asked for again for 5 minutes, and requests for the same URL are shared. The CSP allows `img-src tdc-image:`; the renderer still can't reach any remote host. The temporary UI shows box art in the inventory and reward images next to drops.
- **Not yet verified:** that the installed app (as opposed to the unpacked build) launches. That needs running the installer, which writes a Start menu entry, a desktop shortcut and an uninstall entry for the current user.
