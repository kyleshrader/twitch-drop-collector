// The new UI's text, kept apart from the classic UI's so the two can differ while both exist.
import { duration } from './format'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const strings = {
  title: 'Twitch Drop Collector',
  brand: 'Drop Collector',
  backToClassic: 'Back to the classic UI',
  switching: 'Switching…',
  switchFailed: 'Could not switch. Try again.',
  saveFailed: 'Could not save that change. Try again.',
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
    lead: 'Drop Collector watches streams for you and claims the rewards. Sign in with your Twitch account to begin.',
    status: 'Not signed in',
    restoring: 'Checking your session…',
    signIn: 'Sign in with Twitch',
    waiting: 'Waiting for the login window',
    cancel: 'Cancel'
  },

  current: {
    label: 'Current',
    miningNow: 'Mining now',
    paused: 'Paused',
    pause: 'Pause',
    resume: 'Continue',
    /** Follows the campaign's name: "AOS Drops Day 9, ends in 3 h". */
    endsSuffix: (endsIn: number): string => `, ends in ${duration(endsIn)}`,
    watching: 'Watching',
    viewers: (n: number): string => `${n.toLocaleString()} viewers`,
    notWatchingPaused: 'Not watching while paused',
    change: 'Change',
    changeLabel: 'Change channel',
    channelsFor: (campaign: string): string => `Channels for ${campaign}`,
    letMinerChoose: 'Let the miner choose',
    channelsNote: 'Greyed channels don’t count for this campaign right now.',
    noChannels: 'No channels found for this game yet.',
    unwatchable: {
      offline: 'Offline',
      dropsOff: 'Drops not enabled',
      otherGame: 'Playing another game',
      nothingToEarn: 'Nothing to earn here'
    },
    claimed: 'Claimed',
    awaitsLink: 'Finished, link your account to claim',
    minutes: (have: number, need: number): string => `${have} / ${need} min`,
    unlocksAt: (need: number, toGo: number): string =>
      `Unlocks at ${duration(need)} watched, ${duration(toGo)} to go`,
    remaining: 'remaining',
    pausedHeading: 'Mining is paused',
    pausedLead: 'Nothing is watched until you continue. Your queue stays as it is.',
    idleHeading: 'Not mining right now',
    idleFallback: 'Waiting for something to mine',
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
      priority: 'Priority games in your list’s order, then the least time needed',
      ending: 'The campaigns that end first go first',
      spare: 'The campaigns closest to running out of time go first',
      custom: 'Your own order: drag cards, or use Move up and Move down'
    },
    customFrom: (sort: string): string => `Started from ${sort}. Picking a sort above replaces it.`,
    customHow: 'Drag a card or use Move up / Move down to start one.',
    sortOptions: 'Options',
    linkedFirst: 'Linked games first',
    linkedFirstNote: 'Games that need an account linked go after, in the automatic sorts',
    newInCustom: 'New campaigns in a custom order',
    newInCustomOptions: { byTimeRemaining: 'By time remaining', end: 'At the bottom' },
    sortNote: 'Priority games come before Not set games in every order.',
    reset: (sort: string): string => `Reset to ${sort}`,
    showExcluded: (n: number): string => `Show excluded (${n})`,
    hideExcluded: (n: number): string => `Hide excluded (${n})`,
    excludedHeading: 'Excluded',
    empty: 'Nothing queued. Campaigns for Priority and Not set games show up here.',
    priorityOnly: 'Only Priority games are mined. Not set games wait in the queue.',
    mineNotSet: 'Mine Not set games too',
    drag: 'Drag to reorder',
    dragCampaign: 'Drag up or down to split the game here',
    gameActions: (game: string): string => `Actions for ${game}`,
    campaignActions: (campaign: string): string => `Actions for ${campaign}`,
    moveUp: 'Move up',
    moveDown: 'Move down',
    splitUp: 'Move up, splitting off this and the ones above',
    splitDown: 'Move down, splitting off this and the ones below',
    openInLibrary: 'Open in Library',
    collect: 'Collect now',
    collecting: 'Collecting now',
    alsoCurrent: 'Also in Current',
    alsoCurrentTip: 'Another campaign of this game is in Current',
    split: 'Split',
    splitTip: 'This game is in several places in the queue',
    linked: 'Linked',
    linkedTip: 'Your Twitch account is linked to this game',
    notLinked: 'Not linked',
    notLinkedTip: 'Rewards need a linked account',
    newTag: 'New',
    anyChannel: 'Any channel',
    /** "Only on a, b, c and 2 more": the names are links, so the words come in pieces. */
    onlyOn: 'Only on',
    /** How many names "Only on" shows before "and N more". */
    onlyOnShown: 3,
    andMore: (n: number): string => ` and ${n} more`,
    channelTip: (names: readonly string[]): string => `Only ${names.join(', ')} count`,
    anyChannelTip: 'Any channel streaming the game with drops on counts',
    drops: (done: number, total: number): string => `${done} of ${total} drops`,
    needs: (minutes: number): string => `Needs ${duration(minutes)}`,
    endsStarts: (endsIn: number, startsIn: number | undefined): string =>
      startsIn === undefined
        ? `Ends in ${duration(endsIn)}`
        : `Ends in ${duration(endsIn)}, starts in about ${duration(startsIn)}`,
    notMined: {
      notLinked: 'Not mined: link your account first',
      badgesOff: 'Not mined: badge and emote campaigns are off',
      priorityOnly: 'Not mined: only Priority games are'
    },
    linkAccount: 'Link account',
    wontFinish: (need: number, endsIn: number): string =>
      `Won’t finish in time: needs ${duration(need)}, ends in ${duration(endsIn)}.`,
    savedAtTop: 'Moving it to the top would save it.',
    lostAnyway: 'It won’t finish even at the top.',
    estimate: 'Estimate, assuming a watchable channel is always available.',
    progressesWith: (names: readonly string[]): string =>
      `Progresses together with ${names.join(', ')} (per the queue rules)`
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
    empty: 'This campaign has no drops listed.',
    minutes: (have: number, need: number): string => `${have} / ${need} min`,
    status: {
      claimed: 'Claimed',
      awaitsLink: 'Finished, link your account to claim',
      finished: 'Finished',
      inProgress: 'In progress',
      notStarted: 'Not started',
      ended: 'Window ended'
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
    hidden: (n: number): string =>
      `${plural(n, 'entry', 'entries')} hidden on this device. Nothing was deleted.`,
    undo: 'Undo',
    claimed: 'Claimed',
    linkToClaim: 'Link account to claim',
    ends: (date: string): string => `Ends ${date}`,
    ended: (date: string): string => `Ended ${date}`,
    detail: (rewards: string, game: string, campaign: string): string =>
      `${rewards}, ${game} ${campaign}`
  },

  library: {
    label: 'Library',
    home: 'Home',
    collection: 'Games',
    collectionNote: 'More collections can go here later.',
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
    onTwitchNote: 'Games without drops right now. Open one to put it on a list.',
    searching: 'Searching Twitch…',
    searchFailed: 'Couldn’t search Twitch. Try again in a moment.',
    collapseGroup: (name: string): string => `Collapse ${name}`,
    expandGroup: (name: string): string => `Expand ${name}`,
    allGames: 'All games',
    noCampaigns:
      'Twitch hasn’t listed a drops campaign for this game. Its list applies whenever it gets one.',
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
    accountLabel: 'Twitch account',
    accountLinked: 'Account linked',
    linkOnTwitch: 'Link account on Twitch',
    noLinkNeeded: 'No account link needed',
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
    historyNote: 'Campaigns Twitch no longer lists are counted, but their details aren’t kept yet.',
    notFound: 'This game isn’t in your campaigns any more.'
  },

  settings: {
    heading: 'Settings',
    lead: 'Most settings live on the pages they affect. This page holds the rest for now.',
    theme: 'Theme',
    themeNote: 'Dark is the main theme.',
    themes: { system: 'System', dark: 'Dark', light: 'Light' },
    general: 'General',
    mining: 'Mining',
    toggles: {
      closeToTray: {
        name: 'Keep running in the tray when closed',
        note: 'Closing the window keeps mining.'
      },
      launchAtLogin: {
        name: 'Start when you sign in to the computer',
        note: 'Opens with your computer.'
      },
      startMinimized: { name: 'Start in the tray', note: 'When it starts with the computer.' },
      trayNotifications: { name: 'Notifications', note: 'Say when a drop is claimed.' },
      enableBadgesEmotes: {
        name: 'Mine badge and emote campaigns',
        note: 'They need no linked account.'
      },
      mineNotSet: {
        name: 'Mine Not set games',
        note: 'After Priority games. Off: only Priority games are mined.'
      }
    },
    interface: 'Interface',
    interfaceNote: 'The new UI is in preview. The classic UI is a click away.',
    logs: 'Open the logs folder'
  },

  updates: {
    heading: 'App updates',
    version: (v: string): string => `You’re on version ${v}.`,
    checked: (when: string): string => `Last checked ${when}.`,
    upToDate: 'You have the latest version.',
    unsupported: 'Updates don’t work in this build.',
    checking: 'Checking for updates…',
    available: (v: string): string => `Version ${v} is available`,
    downloading: (v: string, percent: number): string =>
      `Downloading version ${v}: ${Math.round(percent)}%`,
    ready: (v: string): string => `Version ${v} is ready to install`,
    readyNote: 'Mining continues after the restart.',
    error: (reason: string): string => `Could not check for updates: ${reason}`,
    check: 'Check for updates',
    download: 'Download',
    install: 'Restart and update',
    skip: 'Skip this version'
  },

  history: {
    heading: 'History',
    lead: (since: string | undefined): string =>
      since
        ? `What Drop Collector has done on this computer since ${since}: what it watched, what it claimed, and how each campaign ended.`
        : 'What Drop Collector watches and claims, and how each campaign ends, shows up here as it runs.',
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
    statTip: (what: string): string => `Show only ${what.toLowerCase()}`,
    dropsNote: (games: number): string =>
      games === 0 ? 'None in this range' : `From ${plural(games, 'game', 'games')}`,
    watchedNote: (sessions: number): string =>
      sessions === 0 ? 'Nothing watched in this range' : plural(sessions, 'session', 'sessions'),
    completedNote: (ended: number): string =>
      ended === 0 ? 'None ended in this range' : `Of ${ended} that ended`,
    missedNote: (partial: number): string =>
      partial === 0 ? 'Ended with nothing claimed' : `And ${partial} ended part-done`,
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
      partial: (campaign: string): string => `${campaign} ended part-done`,
      missed: (campaign: string): string => `Missed ${campaign}`,
      notEarnable: (campaign: string): string => `${campaign} ended`
    },
    endedDrops: (claimed: number, total: number): string => `${claimed} of ${total} drops`,
    notEarnable: 'your account couldn’t earn it',
    watchedFor: (minutes: number): string => `watched ${duration(minutes)}`,
    newCampaigns: (n: number): string => (n === 1 ? 'New campaign' : `${n} new campaigns`),
    newGame: 'New in your Library',
    started: (campaign: string): string => `${campaign} started`,
    list: {
      priority: 'put on Priority',
      excluded: 'excluded',
      notSet: 'taken off its list (Not set)'
    },
    linked: 'Linked your account for',
    app: {
      paused: 'Paused all activity',
      resumed: 'Resumed mining',
      updated: (version: string, from: string | undefined): string =>
        from ? `Updated to version ${version} (from ${from})` : `Updated to version ${version}`
    },
    appSub: {
      paused: 'Nothing was watched or sent to Twitch until it resumed',
      resumed: 'Watching picked up where the queue stood',
      updated: 'Drop Collector'
    },
    fromTwitch: 'Time from Twitch',
    fromTwitchTip: 'Claimed outside the app, or before it kept claims: the time is Twitch’s.',
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
    empty:
      'Nothing yet. Claims, watching and how campaigns end show up here as Drop Collector runs.',
    noMatch: 'Nothing matches these filters.',
    clearFilters: 'Clear filters',
    showMore: (n: number): string => `Show ${n} more`,
    starts: (running: number): string =>
      running > 0
        ? `The history starts here. ${plural(running, 'campaign was', 'campaigns were')} already running.`
        : 'The history starts here.',
    openGame: (game: string): string => `Open ${game} in the Library`,
    loading: 'Loading the history…',
    failed: 'The history couldn’t be read.'
  },

  twitchApi: {
    heading: 'Twitch API',
    lead: (file: string): string =>
      `Every response from Twitch is checked against what the app expects. Anything that doesn’t match shows up here and in ${file} in the logs folder, so a change on Twitch’s side is caught early.`,
    counts: (errors: number, warnings: number): string => {
      const parts = [
        errors > 0 ? plural(errors, 'error', 'errors') : '',
        warnings > 0 ? plural(warnings, 'warning', 'warnings') : ''
      ].filter(Boolean)
      return parts.length ? parts.join(' and ') : 'No problems'
    },
    none: 'No problems found. Twitch’s responses match what the app expects.',
    checking: 'Running…',
    issuesHeading: 'Issues',
    demo: 'Simulate a change',
    demoTip:
      'Records a made-up mismatch, as if Twitch had changed a response, so you can see the notification, the log and this page at work. Nothing is sent to Twitch.',
    demoChip: 'Demo',
    testCalls: 'Test calls',
    testCallsNote:
      'The read-only requests the app makes, run on demand. Nothing is claimed, watched or changed on Twitch. A response that doesn’t match is recorded above.',
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
    pausedNote: 'Paused: the app isn’t talking to Twitch until you resume.',
    dismiss: 'Dismiss',
    dismissAll: 'Dismiss all',
    report: 'Report on GitHub',
    reportNote:
      'Opens a new GitHub issue in your browser, filled in with these details. They’re redacted: no tokens, and not your user ID or login. Read it over before you submit.',
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
    notFound: 'This issue was dismissed or is no longer kept.',
    notice: (errors: number, warnings: number): string =>
      `Twitch API: ${errors > 0 ? plural(errors, 'error', 'errors') : ''}${
        errors > 0 && warnings > 0 ? ', ' : ''
      }${warnings > 0 ? plural(warnings, 'warning', 'warnings') : ''}`,
    noticeDetail: 'Twitch may have changed something the app relies on.',
    settingsRow: 'Twitch API checks',
    settingsNote: (summary: string): string => `${summary}. Opens the list of mismatches.`,
    open: 'Open'
  }
}
