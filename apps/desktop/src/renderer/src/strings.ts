// All UI text in one place, so an i18n library can replace this module later.
export const strings = {
  appTitle: 'Twitch Drop Collector',
  tabs: { main: 'Main', inventory: 'Inventory', settings: 'Settings' },
  main: {
    loading: 'Loading…',
    version: (version: string, platform: string): string => `Version ${version} (${platform})`,
    openInventory: 'Open Twitch drops inventory'
  },
  account: {
    heading: 'Twitch account',
    restoring: 'Checking your Twitch session…',
    signedOut: 'Not signed in',
    signedInAs: (login: string): string => `Signed in as ${login}`,
    unverified: '(offline, not yet re-checked)',
    signOut: 'Sign out',
    signIn: 'Sign in with Twitch',
    signInNote:
      'Opens Twitch’s own sign-in page in a window. Check that its address bar shows 🔒 www.twitch.tv. Your password goes only to Twitch; this app only receives the sign-in.',
    waitingForWindow: 'Finish signing in in the Twitch window…',
    waitingForCode: 'Waiting for you to enter the code on Twitch…',
    enterCode: 'Your code:',
    openActivate: 'Open twitch.tv/activate (code already filled in)',
    cancel: 'Cancel'
  },
  mining: {
    heading: 'Mining',
    status: {
      stopped: 'Not mining (sign in to start)',
      loading: 'Loading campaigns…',
      idle: 'Idle',
      watching: 'Mining',
      error: 'Problem',
      paused: 'Paused'
    },
    watching: (name: string, game?: string, viewers?: number): string =>
      `Watching ${name}${game ? ` playing ${game}` : ''}${viewers === undefined ? '' : ` (${viewers} viewers)`}`,
    wanted: (games: readonly string[]): string => `Mining for: ${games.join(', ')}`,
    minutes: (done: number, required: number): string => `${done} / ${required} min`,
    claimed: 'Claimed',
    awaitsConnection: 'Ready to claim: connect your game account, then claim it on Twitch',
    reload: 'Reload campaigns',
    letMinerChoose: 'Let the miner choose the channel',
    channels: (count: number): string => `Channels (${count})`,
    columns: {
      channel: 'Channel',
      status: 'Status',
      game: 'Game',
      viewers: 'Viewers',
      drops: 'Drops'
    },
    allowListed: '(allow-listed)',
    online: 'Live',
    offline: 'Offline',
    yes: 'Yes',
    no: 'No',
    watchThis: 'Watch this',
    watchingNow: 'Watching',
    yourPick: '(your pick)',
    unwatchable: {
      offline: 'Offline',
      dropsOff: 'Drops off',
      otherGame: 'Not a wanted game',
      nothingToEarn: 'Nothing to earn here'
    }
  },
  inventory: {
    heading: (count: number): string => `Campaigns (${count})`,
    empty: 'No campaigns yet. Sign in, and they appear once the miner has loaded them.',
    state: { active: 'Active', upcoming: 'Upcoming', expired: 'Ended' },
    allowListed: 'specific channels only',
    linked: 'Account linked',
    notLinked: 'Account not linked',
    noAccountNeeded: 'No game account needed',
    priorityRank: (rank: number) => `Priority #${rank}`,
    excluded: 'Excluded',
    lists: {
      addPriority: 'Add to priority',
      addExcluded: 'Add to excluded',
      removePriority: 'Remove from priority',
      removeExcluded: 'Remove from excluded',
      addPriorityFor: (game: string) => `Add ${game} to priority`,
      addExcludedFor: (game: string) => `Add ${game} to excluded`,
      removePriorityFor: (game: string) => `Remove ${game} from priority`,
      removeExcludedFor: (game: string) => `Remove ${game} from excluded`,
      saveFailed: 'Could not save the change.'
    },
    link: 'Link account',
    filters: {
      label: 'Filter campaigns',
      search: 'Search',
      searchPlaceholder: 'Game or campaign',
      facets: {
        status: 'Status',
        game: 'Game',
        list: 'Your lists',
        account: 'Game account',
        progress: 'Progress',
        rewards: 'Rewards'
      },
      options: {
        status: { active: 'Active', upcoming: 'Upcoming', expired: 'Ended' },
        list: { priority: 'Priority', excluded: 'Excluded', neither: 'Neither' },
        account: { linked: 'Linked', notLinked: 'Not linked', notNeeded: 'Not needed' },
        progress: { notStarted: 'Not started', inProgress: 'In progress', finished: 'Finished' },
        rewards: { items: 'Game items', badgesEmotes: 'Badges and emotes' }
      },
      showAll: (count: number) => `Show all ${count}`,
      showFewer: 'Show fewer',
      clear: 'Clear',
      clearFacet: (facet: string) => `Clear ${facet}`,
      showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
      clearAll: 'Clear all filters',
      none: 'No campaigns match these filters.'
    }
  },
  gameList: {
    empty: 'None yet.',
    placeholder: 'Type to search games with campaigns',
    hint: 'Games with current or upcoming campaigns are suggested. To add any other game, type its name as Twitch shows it and press Enter.',
    options: (label: string) => `${label}: suggestions`,
    upcoming: '(upcoming)',
    addTyped: (name: string) => `Add “${name}”`,
    moveUp: (name: string) => `Move ${name} up`,
    moveDown: (name: string) => `Move ${name} down`,
    remove: (name: string) => `Remove ${name}`
  },
  settings: {
    ui: {
      heading: 'Interface',
      about: 'A new interface is being built. Try it at any time; it has a button to come back.',
      tryNew: 'Try the new UI',
      failed: 'Could not switch. Try again.'
    },
    save: 'Save settings',
    saving: 'Saving…',
    saved: 'Settings saved',
    saveFailed: 'Could not save settings',
    general: {
      heading: 'General',
      launchAtLogin: 'Start at login',
      startMinimized: 'Start in the tray when started at login',
      closeToTray: 'Keep mining in the tray when the window is closed',
      trayNotifications: 'Show a notification when a drop is claimed',
      theme: 'Theme',
      themes: { system: 'Follow system', light: 'Light', dark: 'Dark' }
    },
    mining: {
      heading: 'Mining',
      priority: 'Priority games (highest first)',
      exclude: 'Excluded games',
      priorityMode: 'Priority mode',
      priorityModes: {
        priorityOnly: 'Priority list only',
        endingSoonest: 'Ending soonest first',
        lowAvailabilityFirst: 'Least time to spare first'
      },
      enableBadgesEmotes: 'Mine badge and emote campaigns',
      availableDropsCheck: 'Double-check that channels have drops enabled'
    },
    network: {
      heading: 'Network',
      proxy: 'Proxy URL (leave empty for none)',
      connectionQuality: 'Connection quality (1 = fast, 6 = slow)'
    },
    logging: {
      heading: 'Logging',
      level: 'Log level',
      levels: { error: 'Errors', warn: 'Warnings', info: 'Info', debug: 'Debug' },
      crashReports: 'Keep crash reports on this computer',
      crashReportsNote:
        'Crash reports stay in the app’s folder and are never sent anywhere. Turning this off takes effect after a restart.',
      openFolder: 'Open logs folder'
    },
    updates: {
      heading: 'Updates',
      mode: 'When a new version is out',
      modes: {
        auto: 'Download it and install when I quit',
        notify: 'Tell me, and let me choose',
        off: 'Don’t check by itself'
      },
      prereleases: 'Include pre-release versions',
      skipped: (version: string) => `Skipping version ${version}.`,
      unskip: 'Offer it again',
      check: 'Check for updates',
      checking: 'Checking…'
    }
  },
  updates: {
    current: (version: string) => `You have version ${version}.`,
    status: {
      unsupported: 'Updates aren’t available in this build.',
      idle: 'Not checked yet.',
      checking: 'Checking for updates…',
      upToDate: 'You have the latest version.',
      available: (version: string) => `Version ${version} is available.`,
      downloading: (version: string, percent: number) =>
        `Downloading version ${version}… ${Math.round(percent)}%`,
      ready: (version: string) =>
        `Version ${version} is ready. It installs when you quit, or restart now.`,
      error: (reason: string) => `Could not check for updates: ${reason}`
    },
    lastChecked: (when: string) => `Last checked ${when}.`,
    downloadFailed: (reason: string) => `The download failed: ${reason}`,
    updateNow: 'Update now',
    restartNow: 'Restart now',
    later: 'Later',
    skip: 'Skip this version'
  }
} as const
