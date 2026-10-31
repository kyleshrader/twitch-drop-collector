// App updates: when to check, what to offer, and when to download and install, following the
// updates settings. The update engine (electron-updater) sits behind UpdateEngine, so this runs
// in plain Node tests.
//
// auto: check, download in the background, offer Restart now; installs on quit otherwise.
// notify: check and offer Update now / Later / Skip this version; download only when asked.
// off: no automatic checks; Check for updates in settings still works.
// A skipped version is never offered by automatic checks, never downloaded by itself, and never
// installed on quit. Later hides the offer for that version until the app starts again.
import type { SettingsService } from '@tdc/config'
import type { UpdateView } from '@tdc/ipc-contract'
import type { Clock, Logger } from '@tdc/kernel'

export interface UpdateEngine {
  configure(options: { prereleases: boolean; installOnQuit: boolean }): void
  /** The newer version in the update feed, or undefined when this one is the newest. */
  check(): Promise<string | undefined>
  download(onProgress: (percent: number) => void): Promise<void>
  /** Quits, installs the downloaded version and starts it. */
  quitAndInstall(): void
}

export interface Updater {
  view(): UpdateView
  onChange(listener: (view: UpdateView) => void): () => void
  /** Applies the settings and starts automatic checks (unless the mode is off). */
  start(): void
  stop(): void
  check(options?: { manual?: boolean }): Promise<UpdateView>
  download(): Promise<UpdateView>
  /** False when no update is ready to install. */
  install(): boolean
  dismiss(): UpdateView
  skip(): Promise<UpdateView>
}

type State = Omit<UpdateView, 'currentVersion' | 'skipped'>

const shortError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 200)

export function createUpdater(deps: {
  /** Undefined when updates don't work in this build. */
  engine: UpdateEngine | undefined
  currentVersion: string
  settings: Pick<SettingsService, 'get' | 'update' | 'subscribe'>
  clock: Clock
  logger: Logger
  /** Once per version, when an offer (notify mode) or a downloaded update is new. */
  onNews?: (news: { kind: 'available' | 'ready'; version: string }) => void
  /** Runs right before quitAndInstall, so closing to the tray doesn't stop the quit. */
  beforeInstall?: () => void
  firstCheckMs?: number
  checkEveryMs?: number
}): Updater {
  const {
    engine,
    currentVersion,
    settings,
    clock,
    logger,
    firstCheckMs = 30_000,
    checkEveryMs = 4 * 60 * 60 * 1000
  } = deps
  let state: State = { status: engine ? 'idle' : 'unsupported', dismissed: false }
  let inFlight: Promise<UpdateView> | undefined
  const announced = new Set<string>()
  const listeners = new Set<(view: UpdateView) => void>()
  let timers: ReturnType<typeof setTimeout>[] = []
  let unsubscribe: (() => void) | undefined

  const isSkipped = (version: string | undefined): boolean =>
    version !== undefined && version === settings.get().updates.skippedVersion

  const view = (): UpdateView => ({
    ...state,
    currentVersion,
    skipped: isSkipped(state.version)
  })

  const configure = (): void => {
    const { prereleases } = settings.get().updates
    // A downloaded update installs on quit, unless it's the version the user skipped.
    engine?.configure({ prereleases, installOnQuit: !isSkipped(state.version) })
  }

  const set = (next: State): void => {
    state = next
    configure()
    const current = view()
    for (const listener of listeners) {
      try {
        listener(current)
      } catch (error) {
        logger.error('Update listener failed', { error })
      }
    }
  }

  const announce = (kind: 'available' | 'ready', version: string): void => {
    const key = `${kind}:${version}`
    if (state.dismissed || announced.has(key)) return
    announced.add(key)
    deps.onNews?.({ kind, version })
  }

  const download = async (): Promise<UpdateView> => {
    if (!engine || state.status !== 'available' || state.version === undefined) return view()
    const version = state.version
    set({ ...state, status: 'downloading', percent: 0, error: undefined })
    try {
      await engine.download((percent) => {
        if (state.status === 'downloading') {
          set({ ...state, percent: Math.max(0, Math.min(100, percent)) })
        }
      })
      set({ ...state, status: 'ready', percent: undefined })
      logger.info('Update downloaded', { version })
      announce('ready', version)
    } catch (error) {
      logger.warn('Could not download the update', { version, error: shortError(error) })
      // Back to the offer, so Update now can try again.
      set({ ...state, status: 'available', percent: undefined, error: shortError(error) })
    }
    return view()
  }

  const runCheck = async (manual: boolean): Promise<UpdateView> => {
    if (!engine) return view()
    // A downloaded update stays put; a download in progress carries on.
    if (state.status === 'ready' || state.status === 'downloading') return view()
    const previous = state
    set({ ...state, status: 'checking', error: undefined })
    let version: string | undefined
    try {
      version = await engine.check()
    } catch (error) {
      logger.warn('Could not check for updates', { error: shortError(error) })
      set({
        status: 'error',
        error: shortError(error),
        lastChecked: clock.now().getTime(),
        dismissed: false
      })
      return view()
    }
    const lastChecked = clock.now().getTime()
    if (version === undefined) {
      set({ status: 'upToDate', lastChecked, dismissed: false })
      return view()
    }
    const skipped = isSkipped(version)
    // A manual check always shows the offer. An automatic one keeps Later and Skip in force.
    const dismissed = manual
      ? false
      : skipped || (previous.version === version && previous.dismissed)
    if (previous.version !== version) logger.info('Update available', { version, skipped })
    set({ status: 'available', version, lastChecked, dismissed })
    const { mode } = settings.get().updates
    if (mode === 'auto' && !skipped) return download()
    if (mode === 'notify') announce('available', version)
    return view()
  }

  const check = (options: { manual?: boolean } = {}): Promise<UpdateView> => {
    if (!inFlight) {
      inFlight = runCheck(options.manual ?? false).finally(() => {
        inFlight = undefined
      })
    }
    return inFlight
  }

  const clearTimers = (): void => {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  const schedule = (delayMs: number): void => {
    clearTimers()
    if (!engine || settings.get().updates.mode === 'off') return
    const automatic = (): void => void check()
    timers = [
      setTimeout(() => {
        automatic()
        timers.push(setInterval(automatic, checkEveryMs))
      }, delayMs)
    ]
  }

  return {
    view,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      configure()
      schedule(firstCheckMs)
      unsubscribe = settings.subscribe((next, prev) => {
        const changed =
          next.updates.mode !== prev.updates.mode ||
          next.updates.prereleases !== prev.updates.prereleases
        if (changed) {
          // Check soon after switching updates on or changing the channel.
          schedule(next.updates.prereleases !== prev.updates.prereleases ? 1_000 : firstCheckMs)
        }
        if (changed || next.updates.skippedVersion !== prev.updates.skippedVersion) set(state)
      })
    },
    stop() {
      clearTimers()
      unsubscribe?.()
      unsubscribe = undefined
    },
    check,
    download,
    install() {
      if (!engine || state.status !== 'ready') return false
      logger.info('Installing the update', { version: state.version })
      deps.beforeInstall?.()
      engine.quitAndInstall()
      return true
    },
    dismiss() {
      if (state.version !== undefined) set({ ...state, dismissed: true })
      return view()
    },
    async skip() {
      const version = state.version
      if (version === undefined) return view()
      await settings.update({ updates: { skippedVersion: version } })
      set({ ...state, dismissed: true })
      logger.info('Skipping update', { version })
      return view()
    }
  }
}
