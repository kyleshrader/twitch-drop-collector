// Sign-in, session restore, sign-out, and the headers every authenticated request needs.
// Tokens never leave this service except as request headers.
//
// A session belongs to the Twitch client its token was issued to: the login window signs in as
// the Android app, the device-code flow as the Android TV app (the Android app's client ID no
// longer gets device codes). Every request for that session presents as the same client.
import {
  pickUserAgent,
  type ClientProfile,
  type GqlAuth,
  type IdentityClient,
  type TokenInfo
} from '@tdc/api'
import { AbortError, createEmitter, type Clock, type Logger, type Scheduler } from '@tdc/kernel'

/** What's kept between launches (encrypted by the SessionStore implementation). */
export interface StoredSession {
  accessToken: string
  refreshToken?: string
  userId: string
  login: string
  clientId: string
  deviceId: string
}

export interface SessionStore {
  read(): Promise<StoredSession | undefined>
  write(session: StoredSession): Promise<void>
  clear(): Promise<void>
  /** False when secrets can't be stored safely (Linux without a keyring): sign in each launch. */
  readonly persistent: boolean
}

/** Twitch's login page in an isolated window; resolves with the access token. */
export interface LoginWindow {
  obtainToken(signal: AbortSignal): Promise<string>
  /** Clears the login window's cookies, so the next sign-in asks for credentials again. */
  forget(): Promise<void>
}

export type SignInMethod = 'loginWindow' | 'deviceCode'

export interface TwitchUser {
  id: string
  login: string
}

export type AuthState =
  | { status: 'restoring' }
  | { status: 'signedOut'; message?: string }
  | {
      status: 'signingIn'
      method: SignInMethod
      deviceCode?: { userCode: string; verificationUri: string; expiresAt: string }
    }
  | { status: 'signedIn'; user: TwitchUser; verified: boolean }

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in to Twitch')
    this.name = 'NotSignedInError'
  }
}

export interface AuthService {
  state(): AuthState
  onChange(listener: (state: AuthState) => void): () => void
  /** Restores and re-validates the saved session. Never throws. */
  start(): Promise<void>
  signIn(method: SignInMethod): Promise<void>
  cancelSignIn(): void
  signOut(): Promise<void>
  /** Called when Twitch rejects the token (e.g. GQL 401): forget the session. */
  invalidate(message: string): Promise<void>
  /** Headers for GQL requests, as the session's client. Throws NotSignedInError when signed out. */
  readonly gqlAuth: GqlAuth
  /** For PubSub LISTEN. Throws NotSignedInError when signed out. */
  accessToken(): Promise<string>
  deviceId(): string
}

/**
 * The activation page with the code already filled in. Twitch's verification_uri sometimes has
 * ?device-code=… and sometimes not (the Android TV client's doesn't), so add it when missing.
 */
export function activationUrl(verificationUri: string, userCode: string): string {
  try {
    const url = new URL(verificationUri)
    if (!url.searchParams.has('device-code')) url.searchParams.set('device-code', userCode)
    return url.toString()
  } catch {
    return verificationUri
  }
}

const hex = (length: number, random: () => number): string =>
  Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join('')

const RESTORE_TIMEOUT_MS = 30_000
const EXPIRED_MESSAGE = 'Your Twitch session expired. Sign in again.'

export function createAuthService(deps: {
  /** Identity calls as `profile`, carrying this service's device ID. */
  identity: (profile: ClientProfile, deviceId: () => string) => IdentityClient
  store: SessionStore
  loginWindow: LoginWindow
  /** Which Twitch client each sign-in method presents as. */
  profiles: Record<SignInMethod, ClientProfile>
  clock: Clock
  scheduler: Scheduler
  logger: Logger
  random?: () => number
}): AuthService {
  const { store, loginWindow, profiles, clock, scheduler, logger, random = Math.random } = deps
  const events = createEmitter<{ change: AuthState }>({
    onListenerError: (error) => logger.error('Auth listener failed', { error })
  })

  let state: AuthState = { status: 'signedOut' }
  let session: { stored: StoredSession; profile: ClientProfile } | undefined
  let deviceId = hex(32, random)
  const sessionId = hex(16, random)
  let signingIn: AbortController | undefined

  // One identity client and one user agent per Twitch client, for the whole run.
  const identities = new Map<string, IdentityClient>()
  const identityFor = (profile: ClientProfile): IdentityClient => {
    let client = identities.get(profile.clientId)
    if (!client) identities.set(profile.clientId, (client = deps.identity(profile, () => deviceId)))
    return client
  }
  const userAgents = new Map<string, string>()
  const userAgentFor = (profile: ClientProfile): string => {
    let agent = userAgents.get(profile.clientId)
    if (!agent) userAgents.set(profile.clientId, (agent = pickUserAgent(profile, random)))
    return agent
  }
  const profileFor = (clientId: string): ClientProfile | undefined =>
    Object.values(profiles).find((p) => p.clientId === clientId)

  const setState = (next: AuthState): void => {
    state = next
    events.emit('change', next)
  }

  const current = (): { stored: StoredSession; profile: ClientProfile } => {
    if (state.status !== 'signedIn' || !session) throw new NotSignedInError()
    return session
  }

  const forgetSession = async (message?: string): Promise<void> => {
    session = undefined
    await store.clear()
    setState(message ? { status: 'signedOut', message } : { status: 'signedOut' })
  }

  /** Polls the device-code flow until Twitch grants a token, renewing expired codes. */
  const deviceCodeToken = async (
    identity: IdentityClient,
    signal: AbortSignal
  ): Promise<string> => {
    for (;;) {
      const code = await identity.requestDeviceCode(signal)
      const expiresAt = clock.now().getTime() + code.expires_in * 1000
      setState({
        status: 'signingIn',
        method: 'deviceCode',
        deviceCode: {
          userCode: code.user_code,
          verificationUri: activationUrl(code.verification_uri, code.user_code),
          expiresAt: new Date(expiresAt).toISOString()
        }
      })
      let intervalMs = code.interval * 1000
      while (clock.now().getTime() < expiresAt) {
        await scheduler.sleep(intervalMs, signal)
        const poll = await identity.pollDeviceCode(code.device_code, signal)
        if (poll.status === 'granted') return poll.accessToken
        if (poll.status === 'slowDown') intervalMs += 5000
        if (poll.status === 'expired') break
        if (poll.status === 'denied')
          throw new Error(`Twitch refused the sign-in (${poll.message})`)
      }
      logger.info('Device code expired; requesting a new one')
    }
  }

  return {
    state: () => state,
    onChange: (listener) => events.on('change', listener),

    async start() {
      setState({ status: 'restoring' })
      let stored: StoredSession | undefined
      try {
        stored = await store.read()
      } catch (error) {
        logger.warn('Could not read the saved session', { error })
      }
      if (!stored) {
        setState({ status: 'signedOut' })
        return
      }
      const profile = profileFor(stored.clientId)
      if (!profile) {
        logger.warn('Saved session is for an unknown Twitch client; discarding it')
        await forgetSession(EXPIRED_MESSAGE)
        return
      }
      deviceId = stored.deviceId
      session = { stored, profile }
      let info: TokenInfo | undefined
      try {
        info = await identityFor(profile).validate(
          stored.accessToken,
          AbortSignal.timeout(RESTORE_TIMEOUT_MS)
        )
      } catch (error) {
        // Offline or Twitch unreachable: keep the session and re-validate later.
        logger.warn('Could not validate the saved session; continuing offline', {
          error: error instanceof Error ? error.message : String(error)
        })
        setState({
          status: 'signedIn',
          user: { id: stored.userId, login: stored.login },
          verified: false
        })
        return
      }
      if (info?.client_id !== stored.clientId) {
        await forgetSession(EXPIRED_MESSAGE)
        return
      }
      logger.info('Restored the saved session', { userId: info.user_id, client: profile.name })
      setState({
        status: 'signedIn',
        user: { id: info.user_id, login: info.login },
        verified: true
      })
    },

    async signIn(method) {
      signingIn?.abort()
      const controller = new AbortController()
      signingIn = controller
      const profile = profiles[method]
      const identity = identityFor(profile)
      setState({ status: 'signingIn', method })
      try {
        const accessToken =
          method === 'loginWindow'
            ? await loginWindow.obtainToken(controller.signal)
            : await deviceCodeToken(identity, controller.signal)
        const info = await identity.validate(accessToken, controller.signal)
        if (info?.client_id !== profile.clientId) {
          throw new Error('Twitch did not accept the new sign-in')
        }
        const stored: StoredSession = {
          accessToken,
          userId: info.user_id,
          login: info.login,
          clientId: info.client_id,
          deviceId
        }
        await store.write(stored)
        session = { stored, profile }
        logger.info('Signed in to Twitch', {
          userId: info.user_id,
          client: profile.name,
          persistent: store.persistent
        })
        setState({
          status: 'signedIn',
          user: { id: info.user_id, login: info.login },
          verified: true
        })
      } catch (error) {
        if (signingIn !== controller) return // superseded by a newer sign-in
        const cancelled = controller.signal.aborted || error instanceof AbortError
        if (!cancelled) logger.warn('Sign-in failed', { error })
        setState(
          cancelled
            ? { status: 'signedOut' }
            : {
                status: 'signedOut',
                message: error instanceof Error ? error.message : 'Sign-in failed'
              }
        )
      } finally {
        if (signingIn === controller) signingIn = undefined
      }
    },

    cancelSignIn() {
      signingIn?.abort()
    },

    async signOut() {
      signingIn?.abort()
      await forgetSession()
      await loginWindow.forget()
      logger.info('Signed out of Twitch')
    },

    async invalidate(message) {
      logger.warn('Twitch session invalidated', { message })
      await forgetSession(message)
    },

    gqlAuth: {
      headers: async () => {
        const { stored, profile } = current()
        return {
          'Client-Id': profile.clientId,
          Origin: profile.clientUrl,
          Referer: profile.clientUrl,
          'User-Agent': userAgentFor(profile),
          Authorization: `OAuth ${stored.accessToken}`,
          'Client-Session-Id': sessionId,
          'X-Device-Id': deviceId
        }
      }
    },
    accessToken: async () => current().stored.accessToken,
    deviceId: () => deviceId
  }
}
