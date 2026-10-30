// Twitch PubSub: live drop progress, claims, stream up/down and notifications. Twitch is phasing
// PubSub out for third parties, so the miner depends only on RealtimeSource and a polling
// implementation can replace this one (docs/port-plan.md §4).
import { createBackoff, createEmitter, type Logger, type Scheduler } from '@tdc/kernel'

export interface RealtimeConnectionStatus {
  index: number
  state: 'connecting' | 'connected' | 'reconnecting' | 'stopped'
  topics: number
}

export interface RealtimeSource {
  /** Calls handler with each message's parsed JSON payload. Returns an unsubscribe function. */
  subscribe(topic: string, handler: (message: unknown) => void): () => void
  start(): void
  stop(): Promise<void>
  onStatus(listener: (status: RealtimeConnectionStatus[]) => void): () => void
}

/** The parts of the WHATWG WebSocket API we use (Node's global WebSocket satisfies it). */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

export class TooManyTopicsError extends Error {
  constructor(limit: number) {
    super(`PubSub topic limit reached (${limit})`)
    this.name = 'TooManyTopicsError'
  }
}

/** Topic names, built from Twitch's topic prefixes and a user or channel ID. */
export const pubsubTopics = {
  userDrops: (userId: string) => `user-drop-events.${userId}`,
  userNotifications: (userId: string) => `onsite-notifications.${userId}`,
  channelStreamState: (channelId: string) => `video-playback-by-id.${channelId}`,
  channelSettingsUpdate: (channelId: string) => `broadcast-settings-update.${channelId}`
} as const

const OPEN = 1

interface Connection {
  index: number
  topics: Set<string>
  submitted: Set<string>
  state: RealtimeConnectionStatus['state']
  socket?: WebSocketLike
  /** Aborts this connection's timers and loop. */
  control: AbortController
  /** Ends the current socket session (closes it and lets the loop reconnect). */
  endSession?: () => void
}

export function createPubSub(deps: {
  url: string
  connect: (url: string) => WebSocketLike
  /** Current access token, sent with every LISTEN/UNLISTEN. */
  accessToken: () => Promise<string>
  scheduler: Scheduler
  logger: Logger
  maxConnections?: number
  topicsPerConnection?: number
  pingIntervalMs?: number
  pongTimeoutMs?: number
  random?: () => number
}): RealtimeSource {
  const {
    url,
    connect,
    accessToken,
    scheduler,
    logger,
    maxConnections = 8,
    topicsPerConnection = 50,
    pingIntervalMs = 3 * 60_000,
    pongTimeoutMs = 10_000,
    random = Math.random
  } = deps

  const handlers = new Map<string, Set<(message: unknown) => void>>()
  const connections: Connection[] = []
  const status = createEmitter<{ status: RealtimeConnectionStatus[] }>()
  let running = false

  const nonce = (): string =>
    Array.from(
      { length: 30 },
      () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]
    ).join('')

  const publishStatus = (): void =>
    status.emit(
      'status',
      connections.map((c) => ({ index: c.index, state: c.state, topics: c.topics.size }))
    )

  const setState = (connection: Connection, state: Connection['state']): void => {
    connection.state = state
    publishStatus()
  }

  const send = (connection: Connection, message: object): void => {
    if (connection.socket?.readyState === OPEN) connection.socket.send(JSON.stringify(message))
  }

  /** Brings the server's view of this connection's topics in line with ours. */
  const syncTopics = async (connection: Connection): Promise<void> => {
    if (connection.socket?.readyState !== OPEN) return
    const removed = [...connection.submitted].filter((t) => !connection.topics.has(t))
    const added = [...connection.topics].filter((t) => !connection.submitted.has(t))
    if (removed.length === 0 && added.length === 0) return
    const token = await accessToken()
    for (const [type, topics] of [
      ['UNLISTEN', removed],
      ['LISTEN', added]
    ] as const) {
      for (let i = 0; i < topics.length; i += 20) {
        const chunk = topics.slice(i, i + 20)
        send(connection, { type, nonce: nonce(), data: { topics: chunk, auth_token: token } })
        for (const topic of chunk) {
          if (type === 'LISTEN') connection.submitted.add(topic)
          else connection.submitted.delete(topic)
        }
      }
    }
  }

  const dispatch = (connection: Connection, raw: unknown, onPong: () => void): void => {
    let message: { type?: string; data?: { topic?: string; message?: string }; error?: string }
    try {
      message = JSON.parse(String(raw)) as typeof message
    } catch {
      logger.warn('PubSub sent a non-JSON frame', { index: connection.index })
      return
    }
    switch (message.type) {
      case 'PONG':
        onPong()
        return
      case 'RECONNECT':
        logger.info('PubSub asked us to reconnect', { index: connection.index })
        connection.endSession?.()
        return
      case 'RESPONSE':
        if (message.error) logger.warn('PubSub rejected a request', { error: message.error })
        return
      case 'MESSAGE': {
        const topic = message.data?.topic ?? ''
        let payload: unknown
        try {
          payload = JSON.parse(message.data?.message ?? '')
        } catch {
          logger.warn('PubSub message payload is not JSON', { topic })
          return
        }
        for (const handler of [...(handlers.get(topic) ?? [])]) {
          try {
            handler(payload)
          } catch (error) {
            logger.error('PubSub handler failed', { topic, error })
          }
        }
        return
      }
      default:
        logger.debug('Unknown PubSub frame', { type: message.type })
    }
  }

  /** One socket session: resolves when the socket closes for any reason. */
  const session = (connection: Connection): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const socket = connect(url)
      connection.socket = socket
      const sessionControl = new AbortController()
      const signal = AbortSignal.any([connection.control.signal, sessionControl.signal])
      let opened = false
      let pongReceived = true
      const end = (): void => {
        if (sessionControl.signal.aborted) return
        sessionControl.abort()
        socket.close()
        connection.submitted.clear()
        if (opened) resolve()
        else reject(new Error('PubSub connection failed'))
      }
      connection.endSession = end

      const pingLoop = async (): Promise<void> => {
        while (!signal.aborted) {
          pongReceived = false
          send(connection, { type: 'PING' })
          await scheduler.sleep(pongTimeoutMs, signal)
          if (!pongReceived) {
            logger.warn('PubSub missed a PONG; reconnecting', { index: connection.index })
            end()
            return
          }
          await scheduler.sleep(Math.max(0, pingIntervalMs - pongTimeoutMs), signal)
        }
      }

      socket.addEventListener('open', () => {
        opened = true
        setState(connection, 'connected')
        void syncTopics(connection).catch((error: unknown) =>
          logger.error('PubSub LISTEN failed', { error })
        )
        void pingLoop().catch(() => undefined)
      })
      socket.addEventListener('message', (event) =>
        dispatch(connection, event.data, () => {
          pongReceived = true
        })
      )
      socket.addEventListener('close', end)
      socket.addEventListener('error', end)
    })

  const runConnection = async (connection: Connection): Promise<void> => {
    const backoff = createBackoff({ maxMs: 3 * 60_000, random })
    setState(connection, 'connecting')
    while (!connection.control.signal.aborted) {
      try {
        await session(connection)
        backoff.reset()
      } catch {
        // Couldn't connect at all; fall through to the backoff below.
      }
      if (connection.control.signal.aborted) break
      setState(connection, 'reconnecting')
      try {
        await scheduler.sleep(backoff.next(), connection.control.signal)
      } catch {
        break
      }
    }
    setState(connection, 'stopped')
  }

  const startConnection = (connection: Connection): void => {
    if (connection.control.signal.aborted) connection.control = new AbortController()
    void runConnection(connection)
  }

  const stopConnection = (connection: Connection): void => {
    connection.control.abort()
    connection.endSession?.()
  }

  return {
    subscribe(topic, handler) {
      let set = handlers.get(topic)
      if (!set) {
        let connection = connections.find((c) => c.topics.size < topicsPerConnection)
        if (!connection) {
          if (connections.length >= maxConnections) {
            throw new TooManyTopicsError(maxConnections * topicsPerConnection)
          }
          connection = {
            index: connections.length,
            topics: new Set(),
            submitted: new Set(),
            state: 'stopped',
            control: new AbortController()
          }
          connections.push(connection)
          if (running) startConnection(connection)
        }
        connection.topics.add(topic)
        handlers.set(topic, (set = new Set()))
        void syncTopics(connection)
        publishStatus()
      }
      set.add(handler)

      return () => {
        if (!set.delete(handler) || set.size > 0) return
        handlers.delete(topic)
        const owner = connections.find((c) => c.topics.has(topic))
        if (!owner) return
        owner.topics.delete(topic)
        if (owner.topics.size === 0) {
          stopConnection(owner)
          connections.splice(connections.indexOf(owner), 1)
          connections.forEach((c, i) => (c.index = i))
        } else {
          void syncTopics(owner)
        }
        publishStatus()
      }
    },
    start() {
      if (running) return
      running = true
      for (const connection of connections) startConnection(connection)
    },
    async stop() {
      running = false
      for (const connection of connections) stopConnection(connection)
      publishStatus()
    },
    onStatus: (listener) => status.on('status', listener)
  }
}
