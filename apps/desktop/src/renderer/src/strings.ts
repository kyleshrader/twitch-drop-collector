// All UI text in one place, so an i18n library can replace this module later.
export const strings = {
  appTitle: 'Twitch Drop Collector',
  tabs: { main: 'Main', settings: 'Settings' },
  main: {
    loading: 'Loading…',
    version: (version: string, platform: string): string => `Version ${version} (${platform})`,
    openInventory: 'Open Twitch drops inventory'
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
