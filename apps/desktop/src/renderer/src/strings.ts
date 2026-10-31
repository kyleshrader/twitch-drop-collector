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
      error: 'Problem'
    },
    watching: (name: string, game?: string, viewers?: number): string =>
      `Watching ${name}${game ? ` playing ${game}` : ''}${viewers === undefined ? '' : ` (${viewers} viewers)`}`,
    wanted: (games: readonly string[]): string => `Mining for: ${games.join(', ')}`,
    minutes: (done: number, required: number): string => `${done} / ${required} min`,
    claimed: 'Claimed',
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
    watchThis: 'Watch this'
  },
  inventory: {
    heading: (count: number): string => `Campaigns (${count})`,
    empty: 'No campaigns yet. Sign in, and they appear once the miner has loaded them.',
    state: { active: 'Active', upcoming: 'Upcoming', expired: 'Ended' },
    allowListed: 'specific channels only',
    linked: 'Account linked',
    notLinked: 'Account not linked',
    link: 'Link account'
  },
  settings: {
    save: 'Save settings',
    saving: 'Saving…',
    saved: 'Settings saved',
    saveFailed: 'Could not save settings',
    general: {
      heading: 'General',
      launchAtLogin: 'Start at login',
      startMinimized: 'Start minimised when started at login',
      trayNotifications: 'Show a notification when a drop is claimed',
      theme: 'Theme',
      themes: { system: 'Follow system', light: 'Light', dark: 'Dark' }
    },
    mining: {
      heading: 'Mining',
      priority: 'Priority games (one per line, highest first)',
      exclude: 'Excluded games (one per line)',
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
      levels: { error: 'Errors', warn: 'Warnings', info: 'Info', debug: 'Debug' }
    }
  }
} as const
