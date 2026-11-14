// The app's text, in one place.
import { duration } from './format'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const strings = {
  title: 'Twitch Drop Collector',
  brand: 'Drop Collector',
  saveFailed: 'Couldn’t save that change. Try again.',
  loading: 'Loading…',

  nav: {
    label: 'Pages',
    drops: 'Drops',
    library: 'Library',
    history: 'History',
    pausedTip: 'Mining is paused'
  },

  header: {
    updates: 'App update available',
    updateReady: 'Update ready to install',
    notifications: 'Notifications',
    account: 'Account',
    noNotifications: 'Nothing new.',
    markRead: 'Mark all read',
    wontFinish: (campaign: string): string => `${campaign} won’t finish in time`,
    wontFinishDetail: (game: string, need: number, endsIn: number): string =>
      `${game}: needs ${duration(need)}, ends in ${duration(endsIn)}`,
    minerError: 'The miner hit a problem',
    linkToClaim: (drop: string): string => `${drop} is waiting for a linked account`,
    linkToClaimDetail: (game: string): string => `Link your ${game} account to claim it`,
    lastSync: 'Signed in',
    unverified: 'Session not checked yet',
    session: 'Session',
    sessionOk: 'Valid',
    settings: 'Settings',
    inventory: 'Twitch inventory',
    dropsPage: 'Twitch drops page',
    signOut: 'Sign out'
  },

  watchOnTwitch: 'Watch on Twitch',
  list: {
    groupLabel: (game: string): string => `List for ${game}`,
    priority: 'Priority',
    notSet: 'Not set',
    excluded: 'Excluded'
  },

  signedOut: {
    heading: 'Sign in to start mining',
    lead: 'Earns and claims your Twitch drops in the background.',
    status: 'Not signed in',
    restoring: 'Checking your session…',
    signIn: 'Sign in with Twitch',
    waiting: 'Finish signing in in the Twitch window',
    waitingForCode: 'Enter this code on Twitch',
    openActivate: 'Open twitch.tv/activate',
    cancel: 'Cancel'
  },

  current: {
    label: 'Current',
    miningNow: 'Mining now',
    paused: 'Paused',
    pause: 'Pause',
    resume: 'Resume',
    /** Follows the campaign's name: "AOS Drops Day 9, ends in 3 h". */
    endsSuffix: (endsIn: number): string => `, ends in ${duration(endsIn)}`,
    watching: 'Watching',
    viewers: (n: number): string => `${n.toLocaleString()} viewers`,
    notWatchingPaused: 'Not watching while paused',
    change: 'Change',
    changeLabel: 'Change channel',
    channelsFor: (campaign: string): string => `Channels for ${campaign}`,
    letMinerChoose: 'Let the miner choose',
    channelsNote: 'Grayed-out channels don’t count toward this campaign.',
    noChannels: 'No channels found for this game yet.',
    unwatchable: {
      offline: 'Offline',
      dropsOff: 'Drops not enabled',
      otherGame: 'Playing another game',
      nothingToEarn: 'Nothing to earn here'
    },
    claimed: 'Claimed',
    awaitsLink: 'Finished: link your account to claim it',
    minutes: (have: number, need: number): string => `${have} / ${need} min`,
    unlocksAt: (need: number, toGo: number): string =>
      `Unlocks at ${duration(need)} watched, ${duration(toGo)} to go`,
    remaining: 'remaining',
    pausedHeading: 'Mining is paused',
    pausedLead: 'Nothing is watched until you resume.',
    idleHeading: 'Not mining right now',
    idleFallback: 'Nothing to mine right now',
    loadingHeading: 'Loading your campaigns…'
  },

  upNext: {
    label: 'Up next',
    groupBy: 'Group by',
    groupByLabel: 'Group Up next by',
    layouts: { games: 'Game', campaigns: 'Campaign' },
    layoutTips: {
      games: 'One card per game, with its campaigns inside',
      campaigns: 'One card per campaign'
    },
    sortLabel: 'Sort Up next',
    sortButton: (sort: string): string => `Sort: ${sort}`,
    sorts: {
      priority: 'Priority',
      ending: 'Ending soonest',
      spare: 'Least time to spare',
      custom: 'Custom'
    },
    sortNotes: {
      priority: 'Priority games first, then least time needed',
      ending: 'Campaigns ending first',
      spare: 'Campaigns closest to running out of time',
      custom: 'Your own order'
    },
    customFrom: (sort: string): string => `Based on ${sort}`,
    customHow: 'Drag cards to reorder',
    sortOptions: 'Options',
    linkedFirst: 'Linked games first',
    linkedFirstNote: 'Games that need linking go last',
    newInCustom: 'New campaigns in a custom order',
    newInCustomOptions: { byTimeRemaining: 'By time remaining', end: 'At the bottom' },
    reset: (sort: string): string => `Reset to ${sort}`,
    showExcluded: (n: number): string => `Show excluded (${n})`,
    hideExcluded: (n: number): string => `Hide excluded (${n})`,
    excludedHeading: 'Excluded',
    empty: 'Nothing queued.',
    priorityOnly: 'Only Priority games are being mined.',
    mineNotSet: 'Mine Not set games too',
    drag: 'Drag to reorder',
    dragCampaign: 'Drag to move this campaign',
    gameActions: (game: string): string => `Actions for ${game}`,
    campaignActions: (campaign: string): string => `Actions for ${campaign}`,
    moveUp: 'Move up',
    moveDown: 'Move down',
    splitUp: 'Move up (splits the game)',
    splitDown: 'Move down (splits the game)',
    openInLibrary: 'Open in Library',
    collect: 'Collect now',
    collecting: 'Collecting now',
    alsoCurrent: 'Also in Current',
    alsoCurrentTip: 'Another campaign of this game is being mined',
    split: 'Split',
    splitTip: 'This game appears more than once in the queue',
    linked: 'Linked',
    linkedTip: 'Game account linked',
    notLinked: 'Not linked',
    notLinkedTip: 'Link your game account on Twitch to earn these',
    newTag: 'New',
    anyChannel: 'Any channel',
    /** "Only on a, b, c and 2 more": the names are links, so the words come in pieces. */
    onlyOn: 'Only on',
    /** How many names "Only on" shows before "and N more". */
    onlyOnShown: 3,
    andMore: (n: number): string => ` and ${n} more`,
    channelTip: (names: readonly string[]): string => names.join(', '),
    anyChannelTip: 'Any channel with drops enabled',
    drops: (done: number, total: number): string => `${done} of ${total} drops`,
    needs: (minutes: number): string => `Needs ${duration(minutes)}`,
    endsStarts: (endsIn: number, startsIn: number | undefined): string =>
      startsIn === undefined
        ? `Ends in ${duration(endsIn)}`
        : `Ends in ${duration(endsIn)} · starts in ~${duration(startsIn)}`,
    notMined: {
      notLinked: 'Link your account to mine',
      badgesOff: 'Badge and emote campaigns are off',
      priorityOnly: 'Only Priority games are mined'
    },
    linkAccount: 'Link account',
    wontFinish: (need: number, endsIn: number): string =>
      `Won’t finish in time (needs ${duration(need)}, ends in ${duration(endsIn)}).`,
    savedAtTop: 'Move it to the top to finish it.',
    lostAnyway: 'It can’t finish in time.',
    progressesWith: (names: readonly string[]): string => `Progresses with ${names.join(', ')}`
  },

  upcoming: {
    label: 'Upcoming',
    startsIn: 'Starts in',
    empty: 'No upcoming campaigns.'
  },

  dropList: {
    show: (campaign: string): string => `Show the drops in ${campaign}`,
    hide: (campaign: string): string => `Hide the drops in ${campaign}`,
    label: (campaign: string): string => `Drops in ${campaign}`,
    empty: 'No drops.',
    minutes: (have: number, need: number): string => `${have} / ${need} min`,
    status: {
      claimed: 'Claimed',
      awaitsLink: 'Finished: link your account to claim it',
      finished: 'Finished',
      inProgress: 'In progress',
      notStarted: 'Not started',
      ended: 'Ended'
    },
    startsIn: (minutes: number): string => `Starts in ${duration(minutes)}`,
    window: (from: string, to: string): string => `Only ${from} – ${to}`
  },

  completed: {
    label: 'Completed',
    clearAll: 'Clear all',
    hide: 'Hide',
    hideLabel: (drop: string): string => `Hide ${drop}`,
    empty: 'No completed drops to show.',
    hidden: (n: number): string => `${plural(n, 'entry', 'entries')} hidden.`,
    undo: 'Undo',
    claimed: 'Claimed',
    linkToClaim: 'Link account to claim',
    ends: (date: string): string => `Ends ${date}`,
    ended: (date: string): string => `Ended ${date}`,
    detail: (rewards: string, game: string, campaign: string): string =>
      `${rewards} · ${game} · ${campaign}`
  },

  library: {
    label: 'Library',
    home: 'Home',
    collection: 'Games',
    sortLabel: 'Sort and group games',
    sortings: {
      list: 'Priority / Not set / Excluded',
      account: 'Linked / Not linked / Not needed',
      name: 'A to Z',
      seen: 'Recently seen',
      claimed: 'Recently claimed'
    },
    headings: {
      priority: 'Priority',
      notSet: 'Not set',
      excluded: 'Excluded',
      linked: 'Linked',
      notLinked: 'Not linked',
      notNeeded: 'No account needed',
      today: 'Today',
      yesterday: 'Yesterday',
      thisWeek: 'This week',
      lastWeek: 'Last week',
      thisMonth: 'Earlier this month',
      lastMonth: 'Last month',
      older: 'Older',
      all: 'All games',
      neverClaimed: 'Nothing claimed yet'
    },
    search: 'Search games',
    onTwitch: 'On Twitch',
    onTwitchNote: 'Games without active drops',
    searching: 'Searching Twitch…',
    searchFailed: 'Couldn’t search Twitch.',
    collapseGroup: (name: string): string => `Collapse ${name}`,
    expandGroup: (name: string): string => `Expand ${name}`,
    allGames: 'All games',
    noCampaigns: 'No campaigns right now.',
    filterNames: {
      hideExcluded: 'Hide excluded games',
      active: 'Only games with active campaigns',
      recentlyClaimed: 'Only games claimed in the last 7 days',
      unclaimed: 'Only games with unclaimed rewards'
    },
    noMatch: 'No games match.',
    games: (n: number): string => plural(n, 'game', 'games'),
    seenCount: (n: number): string => `${plural(n, 'campaign', 'campaigns')} seen`,
    breakdown: (
      seen: number,
      counts: Partial<
        Record<'active' | 'upcoming' | 'unclaimed' | 'completed' | 'partial' | 'missed', number>
      >,
      unlisted: number
    ): string => {
      const names = {
        active: 'active',
        upcoming: 'upcoming',
        unclaimed: 'unclaimed',
        completed: 'completed',
        partial: 'partly claimed',
        missed: 'missed'
      }
      const parts = Object.entries(counts).map(([k, n]) => `${n} ${names[k as keyof typeof names]}`)
      if (unlisted > 0) parts.push(`${unlisted} no longer listed`)
      return `${plural(seen, 'campaign', 'campaigns')} seen: ${parts.join(', ')}`
    },
    tile: (seen: number, active: number, unclaimed: number): string =>
      [
        plural(seen, 'campaign', 'campaigns'),
        active ? `${active} active` : '',
        unclaimed ? `${unclaimed} unclaimed` : ''
      ]
        .filter(Boolean)
        .join(', '),
    back: 'Library',
    recorded: (seen: number, listed: number): string =>
      seen > listed
        ? `${plural(seen, 'campaign', 'campaigns')} seen, ${listed} listed by Twitch now`
        : `${plural(seen, 'campaign', 'campaigns')} seen`,
    listLabel: 'List',
    rank: (n: number, of: number): string => `#${n} of ${of}`,
    rankTip: 'Position in your Priority list',
    rankUp: 'Higher priority',
    rankDown: 'Lower priority',
    accountLabel: 'Twitch account',
    accountLinked: 'Account linked',
    linkOnTwitch: 'Link account on Twitch',
    noLinkNeeded: 'No link needed',
    viewOnTwitch: 'View on Twitch',
    campaignsHeading: 'Campaigns',
    columns: {
      status: 'Status',
      campaign: 'Campaign',
      dates: 'Dates',
      drops: 'Drops'
    },
    status: {
      active: 'Active',
      upcoming: 'Upcoming',
      unclaimed: 'Unclaimed',
      completed: 'Completed',
      partial: 'Partly claimed',
      missed: 'Missed'
    },
    historyNote: (n: number): string =>
      n === 1 ? '1 earlier campaign has no details.' : `${n} earlier campaigns have no details.`,
    noLongerListed: 'No longer listed',
    lastSeen: (when: string): string => `Last seen ${when}`,
    notFound: 'Game not found.'
  },

  settings: {
    heading: 'Settings',
    theme: 'Theme',
    themes: { system: 'System', dark: 'Dark', light: 'Light' },
    mining: 'Mining',
    updates: 'Updates',
    network: 'Network',
    diagnostics: 'Diagnostics',
    toggles: {
      closeToTray: { name: 'Keep running in the tray when closed', note: '' },
      launchAtLogin: { name: 'Start with your computer', note: '' },
      startMinimized: { name: 'Start in the tray', note: 'When starting with your computer' },
      trayNotifications: {
        name: 'Notifications',
        note: 'Claimed drops, updates and Twitch API problems'
      },
      mineNotSet: { name: 'Mine Not set games', note: 'After Priority games' },
      enableBadgesEmotes: {
        name: 'Mine badge and emote campaigns',
        note: 'No linked account needed'
      },
      availableDropsCheck: {
        name: 'Confirm drops on each channel',
        note: 'Checks with Twitch before watching, in case a stream’s drops tag is wrong'
      },
      autoUpdate: {
        name: 'Install updates automatically',
        note: 'Downloads in the background and installs when you quit'
      },
      prereleases: { name: 'Get beta versions', note: '' },
      crashReports: {
        name: 'Keep crash reports',
        note: 'Saved on this computer only. Applies after a restart.'
      }
    },
    appUpdates: 'App updates',
    checkNow: 'Check now',
    proxy: 'Proxy',
    proxyNote: 'HTTP or SOCKS. Leave empty to connect directly.',
    proxyPlaceholder: 'socks5://127.0.0.1:1080',
    proxyInvalid: 'Use an http://, https://, socks:// or socks5:// address.',
    connection: 'Connection quality',
    connectionNote: 'Choose a slower setting if requests time out.',
    connectionLevels: (n: number): string =>
      n === 1 ? '1 (fast)' : n === 6 ? '6 (slow)' : String(n),
    logLevel: 'Log detail',
    logLevels: { error: 'Errors', warn: 'Warnings', info: 'Normal', debug: 'Debug' },
    logs: 'Logs',
    openLogs: 'Open folder'
  },

  updates: {
    heading: 'App updates',
    version: (v: string): string => `You’re on version ${v}.`,
    checked: (when: string): string => `Last checked ${when}.`,
    upToDate: 'You have the latest version.',
    unsupported: 'Updates aren’t available in this build.',
    checking: 'Checking for updates…',
    available: (v: string): string => `Version ${v} is available`,
    downloading: (v: string, percent: number): string =>
      `Downloading version ${v}: ${Math.round(percent)}%`,
    ready: (v: string): string => `Version ${v} is ready to install`,
    readyNote: 'The app restarts to install it.',
    error: (reason: string): string => `Couldn’t check for updates: ${reason}`,
    check: 'Check for updates',
    download: 'Download',
    install: 'Restart and update',
    skip: 'Skip this version'
  },

  history: {
    heading: 'History',
    lead: (since: string | undefined): string => (since ? `Since ${since}` : ''),
    rangeLabel: 'Time range',
    ranges: { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' },
    filterLabel: 'Show',
    filters: {
      all: 'Everything',
      claims: 'Claims',
      watching: 'Watching',
      campaigns: 'Campaigns',
      library: 'Library & app'
    },
    search: 'Search games, rewards and channels',
    stats: {
      drops: 'Drops claimed',
      watched: 'Time watched',
      completed: 'Campaigns completed',
      missed: 'Campaigns missed'
    },
    statTip: (what: string): string => `Filter by ${what.toLowerCase()}`,
    dropsNote: (games: number): string =>
      games === 0 ? 'None in this range' : `From ${plural(games, 'game', 'games')}`,
    watchedNote: (sessions: number): string =>
      sessions === 0 ? 'None in this range' : plural(sessions, 'session', 'sessions'),
    completedNote: (ended: number): string =>
      ended === 0 ? 'None ended in this range' : `Of ${ended} that ended`,
    missedNote: (partial: number): string =>
      partial === 0 ? 'Ended with nothing claimed' : `And ${partial} ended partly claimed`,
    today: 'Today',
    yesterday: 'Yesterday',
    daySummary: (drops: number, minutes: number): string =>
      [
        drops > 0 ? plural(drops, 'drop', 'drops') : '',
        minutes >= 1 ? `${duration(minutes)} watched` : ''
      ]
        .filter(Boolean)
        .join(' · '),
    watched: (minutes: number): string => `Watched for ${duration(minutes)}`,
    on: 'on',
    ended: {
      completed: (campaign: string): string => `Completed ${campaign}`,
      partial: (campaign: string): string => `${campaign} ended partly claimed`,
      missed: (campaign: string): string => `Missed ${campaign}`,
      notEarnable: (campaign: string): string => `${campaign} ended`
    },
    endedDrops: (claimed: number, total: number): string => `${claimed} of ${total} drops`,
    notEarnable: 'not linked',
    watchedFor: (minutes: number): string => `watched ${duration(minutes)}`,
    newCampaigns: (n: number): string => (n === 1 ? 'New campaign' : `${n} new campaigns`),
    newGame: 'New in your Library',
    started: (campaign: string): string => `${campaign} started`,
    list: {
      priority: 'put on Priority',
      excluded: 'excluded',
      notSet: 'moved to Not set'
    },
    linked: 'Linked your account for',
    app: {
      paused: 'Paused all activity',
      resumed: 'Resumed mining',
      updated: (version: string, from: string | undefined): string =>
        from ? `Updated to version ${version} (from ${from})` : `Updated to version ${version}`
    },
    appSub: {
      paused: '',
      resumed: '',
      updated: ''
    },
    fromTwitch: 'Time from Twitch',
    fromTwitchTip: 'Claim time reported by Twitch',
    games: 'Games',
    gamesNote: 'By time watched in this range',
    gameRow: (minutes: number, drops: number): string =>
      [minutes >= 1 ? duration(minutes) : '', drops > 0 ? plural(drops, 'drop', 'drops') : '']
        .filter(Boolean)
        .join(' · '),
    onlyGame: (game: string): string => `Only ${game}`,
    allGames: 'All games',
    showAllGames: (n: number): string => `Show all ${n}`,
    showFewerGames: 'Show fewer',
    empty: 'No activity yet.',
    noMatch: 'Nothing matches these filters.',
    clearFilters: 'Clear filters',
    showMore: (n: number): string => `Show ${n} more`,
    starts: (running: number): string =>
      running > 0
        ? `History begins · ${plural(running, 'campaign', 'campaigns')} already running`
        : 'History begins',
    openGame: (game: string): string => `Open ${game} in the Library`,
    loading: 'Loading the history…',
    failed: 'Couldn’t load the history.'
  },

  twitchApi: {
    heading: 'Twitch API',
    lead: (file: string): string =>
      `Responses from Twitch that don’t match what the app expects. Also logged to ${file}.`,
    counts: (errors: number, warnings: number): string => {
      const parts = [
        errors > 0 ? plural(errors, 'error', 'errors') : '',
        warnings > 0 ? plural(warnings, 'warning', 'warnings') : ''
      ].filter(Boolean)
      return parts.length ? parts.join(' and ') : 'No problems'
    },
    none: 'No problems found.',
    checking: 'Running…',
    issuesHeading: 'Issues',
    demo: 'Simulate a change',
    demoTip: 'Adds a sample issue. Nothing is sent to Twitch.',
    demoChip: 'Sample',
    testCalls: 'Test calls',
    testCallsNote: 'Read-only requests. Nothing is claimed or changed.',
    runAll: 'Run all',
    run: 'Run',
    runOne: (endpoint: string): string => `Run ${endpoint}`,
    passed: (ms: number): string => `Passed in ${ms} ms`,
    failed: (ms: number): string => `Failed after ${ms} ms`,
    notRun: 'Not run yet',
    showResponse: 'Response',
    hideResponse: 'Hide',
    signInToTest: 'Sign in to run test calls.',
    checked: (passed: number, total: number): string =>
      total === 0
        ? ''
        : passed === total
          ? `All ${total} requests passed.`
          : `${passed} of ${total} requests passed.`,
    openFolder: 'Open the log folder',
    pause: 'Pause all activity',
    resume: 'Resume',
    pausedNote: 'All activity is paused.',
    dismiss: 'Dismiss',
    dismissAll: 'Dismiss all',
    report: 'Report on GitHub',
    reportNote: 'Opens a prefilled issue in your browser. Personal details are removed.',
    back: 'Twitch API',
    severity: { error: 'Error', warning: 'Warning' },
    source: { gql: 'GQL', pubsub: 'PubSub', identity: 'Sign-in' },
    kind: {
      shape: 'Response changed',
      error: 'Unknown error',
      http: 'HTTP status',
      partial: 'Field failed',
      retried: 'Needed a retry'
    },
    times: (n: number): string => plural(n, 'time', 'times'),
    seen: (count: number, first: string, last: string): string =>
      count === 1
        ? `Seen once, ${last}`
        : `Seen ${plural(count, 'time', 'times')}, ${first} to ${last}`,
    lastSeen: (when: string): string => `last ${when}`,
    differences: 'What didn’t match',
    expected: 'Expected',
    actual: 'Actual',
    missing: '(missing)',
    nothing: '(nothing)',
    response: 'The response',
    notFound: 'Issue not found.',
    notice: (errors: number, warnings: number): string =>
      `Twitch API: ${errors > 0 ? plural(errors, 'error', 'errors') : ''}${
        errors > 0 && warnings > 0 ? ', ' : ''
      }${warnings > 0 ? plural(warnings, 'warning', 'warnings') : ''}`,
    noticeDetail: 'Twitch may have changed something the app relies on.',
    settingsRow: 'Twitch API checks',
    settingsNote: (summary: string): string => summary,
    open: 'Open'
  }
}
