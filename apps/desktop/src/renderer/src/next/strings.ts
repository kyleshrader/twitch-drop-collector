// The new UI's text, kept apart from the classic UI's so the two can differ while both exist.
export const strings = {
  title: 'Twitch Drop Collector',
  preview: 'New UI preview',
  intro:
    'The new UI is being built. Everything works in the classic UI, and you can switch back at any time.',
  backToClassic: 'Back to the classic UI',
  switching: 'Switching…',
  switchFailed: 'Could not switch. Try again.',
  status: {
    signedOut: 'Not signed in',
    signedIn: (login: string): string => `Signed in as ${login}`
  },
  miner: (status: string): string => `Miner: ${status}`
}
