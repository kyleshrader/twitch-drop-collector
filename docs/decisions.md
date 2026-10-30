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

## Carried into M2

- `apps/desktop/src/main/index.ts` still has the scaffold's `sandbox: false`; there's no single-instance lock yet, and CSP and navigation rules aren't finalised. All of these are M2 scope.

## 2026-10-29 · LF line endings in git

- **Decision:** `* text=auto eol=lf` in `.gitattributes`.
- **Reason:** `.editorconfig` and Prettier use LF; with `core.autocrlf=true` on Windows, checkouts would otherwise be CRLF and `prettier --check` would fail.
