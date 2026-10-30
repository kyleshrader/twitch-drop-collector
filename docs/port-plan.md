# Port plan: TwitchDropsMiner → Twitch Drop Collector

Status: **accepted 2026-10-30**. Nothing here is built yet.

Reference: [DevilXD/TwitchDropsMiner](https://github.com/DevilXD/TwitchDropsMiner), branch `dev-build`, commit `99d12fd` (2026-10-28).

**Approach: a rewrite.** New TypeScript in our own architecture, using the behaviour rules in §3 and the protocol details (endpoints, GQL operation names and hashes, PubSub topics, timings, client profiles) exactly as they need to be. No licence bookkeeping is needed for a rewrite like this.

## 1. What their app is

About 8.2k lines of Python (asyncio + aiohttp + Tkinter):

| File           | Lines | What it does                                                                                                         |
| -------------- | ----: | -------------------------------------------------------------------------------------------------------------------- |
| `twitch.py`    | 1,720 | Everything: auth, HTTP, GQL, the main state machine, channel selection, watch loop, PubSub handlers, inventory fetch |
| `gui.py`       | 2,971 | Tkinter UI: main tab, inventory, settings, help, tray, login form                                                    |
| `inventory.py` |   510 | `DropsCampaign`, `TimedDrop`, `Benefit`: eligibility, progress, claiming                                             |
| `channel.py`   |   506 | `Channel`, `Stream`: online state, "watching" (HLS playlist HEAD requests)                                           |
| `constants.py` |   511 | Client IDs, persisted GQL query hashes, PubSub topics, timings                                                       |
| `websocket.py` |   404 | PubSub pool: up to 8 sockets × 50 topics, ping/pong, reconnect                                                       |
| `utils.py`     |   458 | Backoff, rate limiter, JSON helpers, `Game`                                                                          |
| `translate.py` |   515 | i18n, with 20 language files in `lang/`                                                                              |
| other          |  ~600 | settings, cache (images), exceptions, Windows registry (autostart)                                                   |

### Why it's hard to work with

- **`Twitch` is a god object.** Auth, transport, orchestration and domain rules all live in one class, and almost everything holds a reference back to it.
- **Domain models do I/O and drive the UI.** `TimedDrop.claim()` calls GQL and then `gui.tray.notify()`. `Channel.display()` writes to the channel list. You can't test a drop rule without a client and a GUI.
- **The state machine is one 280-line `if/elif`** driven by an `asyncio.Event`. State changes come from websocket handlers, the maintenance timer, the watch loop and the GUI, all calling `change_state()` directly.
- **Time is implicit.** Rules call `datetime.now()` inline, so time-based logic can't be tested deterministically.
- **Settings are magic.** `__getattr__` merges CLI args and the JSON file, and nothing is validated.
- **Dead and alternative paths sit next to each other**: three ways to "watch", three login flows (one used), unused GQL operations.

## 2. Target architecture

Services with explicit dependencies, plain factory functions, and one composition root, which is your style. No DI container: TypeScript interfaces plus `createX(deps)` factories give the same testability without decorators or `reflect-metadata`.

### Conventions

- Every service is created by a `createXxx(deps): Xxx` factory. `deps` is a single object of interfaces, never concrete classes from another package.
- Long-lived services implement `start(): Promise<void>` and `stop(): Promise<void>`. The root starts them in order and stops them in reverse.
- Services expose state changes as typed events (`on('inventoryChanged', fn)`) and read-only snapshots, and they never call the UI. Main bridges events to the renderer over IPC.
- **Domain rules are pure functions over plain data**, and time is a parameter (`now: Date`). Example: `canEarn(drop, campaign, { channel, now, settings })`. These are the bulk of the unit tests.
- Electron-specific capabilities (`net.fetch`, `safeStorage`, `WebSocket`, paths, notifications, power and online state) are interfaces defined in the packages and implemented in `apps/desktop/src/main/adapters/`, as the spec already requires.

### Composition root (`apps/desktop/src/main/index.ts`)

A sketch, not final code:

```ts
void (async () => {
  await app.whenReady()
  const paths = createPaths({ app })
  const logger = createLogger({ file: paths.log, level: 'info' }) // electron-log adapter
  const settings = await createSettingsService({
    store: createJsonFileStore({ file: paths.settings }),
    logger: logger.child('settings')
  })
  logger.setLevel(settings.get().logging.level)

  const clock = systemClock
  const db = await openDatabase({ file: paths.db, logger: logger.child('db') })
  const secrets = createSafeStorageSecrets({ safeStorage, dir: paths.userData })
  const connectivity = createConnectivity({ net, powerMonitor, logger: logger.child('net') })

  // @tdc/api: transport only, no domain decisions
  const profile = clientProfiles.androidApp
  const http = createHttpClient({
    fetch: net.fetch,
    profile,
    settings,
    logger: logger.child('http')
  })
  const auth = createAuthService({
    http,
    secrets,
    profile,
    login: createLoginWindowStrategy({ BrowserWindow }),
    logger: logger.child('auth')
  })
  const gql = createGqlClient({ http, auth, logger: logger.child('gql') })
  const pubsub = createPubSubClient({
    connect: (url) => new WebSocket(url),
    auth,
    logger: logger.child('pubsub')
  })
  const watcher = createHlsWatchClient({ http, gql })

  // @tdc/core: domain services
  const inventory = createInventoryService({
    gql,
    auth,
    clock,
    settings,
    cache: db.campaigns,
    logger: logger.child('inventory')
  })
  const channels = createChannelService({ gql, pubsub, clock, logger: logger.child('channels') })
  const watch = createWatchService({ watcher, gql, clock, logger: logger.child('watch') })
  const miner = createMiner({
    inventory,
    channels,
    watch,
    pubsub,
    settings,
    connectivity,
    clock,
    notifier: createNotifier({ Notification }),
    logger: logger.child('miner')
  })

  const shell = await createAppShell({ settings, logger: logger.child('shell') }) // window, tray, single instance
  registerIpcHandlers({ ipcMain, miner, settings, auth, inventory, logger: logger.child('ipc') })

  const services = [connectivity, pubsub, miner, shell]
  app.on('before-quit', () => void stopAll(services.toReversed()))
  await startAll(services)
})().catch((error) => {
  fatal(error) // log, show an error dialog, exit non-zero
})
```

### Packages

The spec's layout mostly fits. **One change is needed:** a small shared-kernel package, because the logger, clock and event types are needed by `api`, `storage`, `config` and `core`, but rule 2 forbids those three from importing each other.

| Package             | Holds                                                                                                                                                                        | May import                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `@tdc/kernel` (new) | `Logger`, `Clock`, `Scheduler`, typed `Emitter`, `Disposable`/`Service`, `backoff()`, `RateLimiter`, `Result`/error base types                                               | nothing (zod at most)        |
| `@tdc/config`       | settings schema (zod), defaults, migrations, `createSettingsService({ store })` (get, update, subscribe)                                                                     | kernel                       |
| `@tdc/api`          | Twitch transport: HTTP client, GQL client and operation registry with zod response schemas, PubSub pool, identity (validate, device code), HLS watch client, client profiles | kernel                       |
| `@tdc/storage`      | SQLite: campaign/game cache, claim history, image cache index, migrations                                                                                                    | kernel                       |
| `@tdc/core`         | domain model and rules (pure), plus `InventoryService`, `ChannelService`, `WatchService`, `Miner`, and the ports they need                                                   | kernel, api, storage, config |
| `@tdc/ipc-contract` | channels plus the `MinerSnapshot` view model schema                                                                                                                          | zod                          |
| `@tdc/ui`           | components                                                                                                                                                                   | react                        |

This adds a rule 8 to the dependency rules: _kernel imports nothing from the workspace, and every non-UI package may import it._ That change goes in ESLint, the Yarn constraints and the boundary tests.

### Where their code goes

| Theirs                                                                                  | Ours                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Twitch.request`, `get_session`, cookie jar                                             | `api/http`: `net.fetch` with backoff, timeouts scaled by `connectionQuality`, proxy. No cookie jar: the device ID and token live in `secrets`.                                    |
| `Twitch.gql_request`, `GQL_QUERIES`, `RateLimiter(5, 1s)`                               | `api/gql`: one file per operation with typed variables and a zod response schema; batching (max 20); the same retry rules                                                         |
| `websocket.py`                                                                          | `api/pubsub`: pool, ping and reconnect, typed topic events. The miner subscribes; the pool never calls back into domain code.                                                     |
| `_AuthState`                                                                            | `core/auth` (or `api/identity` plus a thin service): token validate, user ID, device ID, invalidate/sign-out                                                                      |
| `Channel.send_watch`, `Stream.get_stream_url`                                           | `api/watch`: the HLS playlist plus HEAD requests on chunks. Spade and GQL watch are not ported (unused upstream).                                                                 |
| `inventory.py` classes                                                                  | `core/domain`: plain `Campaign`, `Drop`, `Benefit` and `Game` data, plus pure rules (`canEarn`, `canEarnWithin`, `canClaim`, `isClaimedFromBenefits`, `progress`, `availability`) |
| `fetch_inventory`, `fetch_campaigns`, `_merge_data`                                     | `core/inventory`: fetch → merge → map to domain → emit. Claiming lives here too.                                                                                                  |
| `get_live_streams`, `bulk_check_online`, channel bookkeeping, `ONLINE_DELAY`            | `core/channels`: tracked set, ACL vs. directory discovery, PubSub topic sync, pending-online timer                                                                                |
| `_watch_loop`, progress fallback (`CurrentDrop`, minute bump)                           | `core/watch`                                                                                                                                                                      |
| `_run` state machine, `_maintenance_task`, `should_switch`, `get_priority`, `can_watch` | `core/miner`: an explicit state machine (`dispatch(event)` → transitions) over pure selection rules (`selectWantedGames`, `rankChannels`, `pickChannel`)                          |
| `settings.py`                                                                           | `config`: zod schema, defaults and migrations; CLI flags become dev-only env vars                                                                                                 |
| `cache.py` (image cache)                                                                | `storage` index plus a main-process `tdc-image://` protocol. The renderer's CSP blocks remote images, so main fetches and caches them.                                            |
| `registry.py` and the Linux `.desktop` code                                             | M4 launch-at-login (`setLoginItemSettings` and an autostart file)                                                                                                                 |
| `gui.py`                                                                                | not ported. A temporary React UI with the same features (§5), driven by `MinerSnapshot` pushes and TanStack Query, to be redesigned later.                                        |
| `translate.py` and `lang/*.json`                                                        | i18n later, with our own translations. Until then, keep UI strings in one module so adding an i18n library is a drop-in change.                                                   |
| `--dump`                                                                                | dev-only "export diagnostics" command (redacted campaign JSON)                                                                                                                    |

### Not porting

- Username and password login via `passport.twitch.tv`. It's dead code upstream (captcha leads to `CaptchaRequired`).
- `zendriver`, which drives an external Chrome. See §4.
- Spade and GQL watch methods, the unused GQL operations (channel points, notifications list), and the Windows registry module.

## 3. Behaviour to preserve

These are the rules worth carrying over exactly. Each one becomes a unit test in `core`, written before the port.

**Campaigns and drops**

- A campaign is eligible if the account is linked, or, when it has badge or emote rewards, if the `enableBadgesEmotes` setting is on.
- A drop can be earned when its preconditions are claimed, it isn't claimed, it has benefits or is part of a precondition chain, its required minutes are above 0, its extra (estimated) minutes are under 15, and `startsAt ≤ now < endsAt`. The campaign must also be eligible and active, and the channel must be in its ACL (if it has one) and playing the campaign's game. Games `509663` and `509672` are "special" and can be earned on any channel.
- When there's no `self` edge, a drop counts as claimed if all of its benefits appear in `gameEventDrops`, with `lastAwardedAt` inside the drop's window.
- A drop is claimable while it has a claim ID, isn't claimed, and it's before campaign end + 24h. Claims run on load for active and expired campaigns, and on the PubSub `drop-claim` event. After a claim, wait 4s, then poll `CurrentDrop` up to 8 times, 2s apart, until the drop ID changes before resuming.

**Choosing what to watch**

- Wanted games: sort campaigns by priority mode (`priorityOnly`, `endingSoonest`, or `lowAvailabilityFirst`), then by the user's priority list. Keep games that aren't excluded, are in the priority list when the mode is `priorityOnly`, and can be earned within the next hour.
- Channel discovery: ACL channels come from wanted campaigns and are bulk-checked online 20 per GQL batch. Campaigns without an ACL use the game directory (`DROPS_ENABLED`, 20 per game). Rank by game priority, then ACL first, then viewers descending. Cap at 199 channels (8 sockets × 50 topics − 2 base topics, 2 topics per channel).
- Switching: the user's manual selection wins if it's watchable. Otherwise switch only for a strictly better game priority, or the same priority when the new channel is on the ACL and the current one isn't.
- `stream-up` events are trusted only after 120s plus a re-fetch. `broadcast-settings-update` triggers the same delayed re-check.

**Watching and progress**

- Send a watch every 20s: fetch the HLS playlist and send HEAD requests for each chunk.
- About 15s after each send, if progress hasn't updated for about a minute, ask GQL `CurrentDrop`. If that fails, add one estimated minute to the active campaign, up to 15 extra minutes.

**Background events**

- Maintenance: reload the full inventory every hour, and clean up channels at every campaign or drop start/end time within that hour.
- Notifications: on `user_drop_reward_reminder_notification` or `quests_viewer_reward_campaign_earned_emote`, re-fetch the inventory and delete the notification.

**Transport**

- GQL is limited to 5 requests per 1s window ("do not modify", upstream). On `service error` or `PersistedQueryNotFound`, retry once with at least a 5s wait. On `service timeout`, `request cancelled`, `service unavailable` or `context deadline exceeded`, retry with backoff. On `server error`, null out the errored path and continue.
- HTTP: exponential backoff (base 2, ±10% jitter, max 3 min) on connection errors and 5xx responses.

## 4. Decisions

1. **`@tdc/kernel` package** (§2). **Accepted 2026-10-30**; see the decision log.
2. **Login method. Accepted: support both.** `dev-build` doesn't use the device-code flow. It still has the code, but it logs in by opening Chrome at Twitch's login page and reading `#access_token=` from the redirect. Why they switched is unknown. We use an `AuthStrategy` interface with two implementations:
   - **Login window:** an Electron `BrowserWindow` on an isolated, persistent session partition with no preload. It's sandboxed, never shares our app's session, and catches the redirect URL. No external Chrome is needed.
   - **Device code:** the simpler user experience, if it still works for the client ID.

   Both get tried against the live API in M7, and whichever works becomes the default. Client identity: the Android app profile, as upstream (decided 2026-10-30, see the decision log).

3. **PubSub. Accepted.** Hidden behind a `RealtimeSource` interface, so a polling fallback (GQL `CurrentDrop` plus periodic stream checks) can replace it without touching the miner.
4. **Offline behaviour. Accepted.** A `Connectivity` service (`net.isOnline`, `powerMonitor` suspend/resume, failed-request signals) moves the miner into `paused`. On resume it re-validates auth and does a full inventory reload instead of trusting stale state.
5. **Scope of v1. Accepted: feature parity in a temporary UI.** Everything their app does, including the image cache, in a plain React UI laid out roughly like theirs (§5). It's English only, with strings kept in one module. A UX redesign and translations come later.
6. **Milestone order. Accepted 2026-10-30.** The spec's M3–M8 are infrastructure, and the port fits around them:
   - **M3 IPC:** contract designed around `MinerSnapshot` plus commands (settings, auth start/cancel, select channel, reload).
   - **M4 config:** their settings, ported.
   - **M5 storage:** campaign cache and claim history.
   - **M6 network:** `api` (HTTP, GQL operations, PubSub, watch), tested against recorded fixtures with tokens and IDs scrubbed.
   - **M7 auth:** the strategies above.
   - **New M7b "Miner":** `core` domain rules (tests first, from §3), then services, then the miner state machine, wired into the UI.
   - **M8 tray/background:** as spec, plus the connectivity pause/resume.
   - Then M9–M12 as in the spec.

## 5. Temporary UI: feature checklist

Feature parity with their app, not a copy of their layout. This is throwaway scaffolding for exercising the engine; the real UX gets designed separately.

- **Main:** login state and sign-out; current status line; the drop being mined (campaign, game, reward, progress, countdown); the channel list (name, online state, game, viewers, drops enabled, ACL-based, currently watching), with a manual "watch this channel"; PubSub connection status; a log console; a reload button.
- **Inventory:** campaigns with game box art, name, dates and state (active, upcoming, expired); account-linked status with a link button; each drop's rewards, images, progress and claimed state; filters (not linked, upcoming, expired, finished, badges and emotes).
- **Settings:** priority list and priority mode, exclude list, badges and emotes, available-drops check, start at login, start minimised to tray, tray notifications, theme (follows OS by default), proxy, connection quality.
- **Help/About:** short usage notes, links, version.
- **Tray:** icon per state (idle, mining, maintenance, error), a notification on each claim, show/hide and quit.
