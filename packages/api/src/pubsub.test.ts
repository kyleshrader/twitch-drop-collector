import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { createPubSub, pubsubTopics, TooManyTopicsError, type RealtimeSource } from './pubsub'
import { systemScheduler } from './runtime'
import { testLogger } from './test/mock-server'

interface Frame {
  type: string
  nonce?: string
  data?: { topics?: string[]; auth_token?: string }
}

/** Plays Twitch's side of PubSub. */
class FakePubSub {
  readonly server: WebSocketServer
  readonly sockets: { socket: ServerSocket; topics: Set<string>; frames: Frame[] }[] = []
  answerPings = true

  constructor() {
    this.server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    this.server.on('connection', (socket) => {
      const entry = { socket, topics: new Set<string>(), frames: [] as Frame[] }
      this.sockets.push(entry)
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as Frame
        entry.frames.push(frame)
        if (frame.type === 'PING' && this.answerPings) socket.send(JSON.stringify({ type: 'PONG' }))
        for (const topic of frame.data?.topics ?? []) {
          if (frame.type === 'LISTEN') entry.topics.add(topic)
          if (frame.type === 'UNLISTEN') entry.topics.delete(topic)
        }
        if (frame.type === 'LISTEN' || frame.type === 'UNLISTEN') {
          socket.send(JSON.stringify({ type: 'RESPONSE', nonce: frame.nonce, error: '' }))
        }
      })
    })
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  get open(): typeof this.sockets {
    return this.sockets.filter((s) => s.socket.readyState === s.socket.OPEN)
  }

  publish(topic: string, payload: object): void {
    for (const { socket, topics } of this.open) {
      if (topics.has(topic)) {
        socket.send(
          JSON.stringify({ type: 'MESSAGE', data: { topic, message: JSON.stringify(payload) } })
        )
      }
    }
  }

  listening(): Promise<void> {
    return new Promise((resolve) => this.server.once('listening', () => resolve()))
  }

  close(): Promise<void> {
    for (const { socket } of this.sockets) socket.terminate()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }
}

let server: FakePubSub
let pubsub: RealtimeSource | undefined

beforeEach(async () => {
  server = new FakePubSub()
  await server.listening()
})
afterEach(async () => {
  await pubsub?.stop()
  await server.close()
})

function create(options: { pingIntervalMs?: number; pongTimeoutMs?: number } = {}): RealtimeSource {
  pubsub = createPubSub({
    url: server.url,
    connect: (url) => new WebSocket(url),
    accessToken: async () => 'token-123',
    scheduler: systemScheduler,
    logger: testLogger(),
    pingIntervalMs: options.pingIntervalMs ?? 60_000,
    pongTimeoutMs: options.pongTimeoutMs ?? 1_000,
    random: () => 0
  })
  return pubsub
}

describe('pubsub', () => {
  it('listens with the auth token and delivers parsed messages', async () => {
    const realtime = create()
    const handler = vi.fn()
    realtime.subscribe(pubsubTopics.userDrops('42'), handler)
    realtime.start()

    await vi.waitFor(() => expect(server.open[0]?.topics.has('user-drop-events.42')).toBe(true))
    const listen = server.open[0]!.frames.find((f) => f.type === 'LISTEN')!
    expect(listen.data?.auth_token).toBe('token-123')
    expect(listen.nonce).toHaveLength(30)

    server.publish('user-drop-events.42', { type: 'drop-progress', data: { drop_id: 'd1' } })
    await vi.waitFor(() =>
      expect(handler).toHaveBeenCalledWith({ type: 'drop-progress', data: { drop_id: 'd1' } })
    )
  })

  it('spreads topics over connections, 50 per socket', async () => {
    const realtime = create()
    for (let i = 0; i < 60; i++)
      realtime.subscribe(pubsubTopics.channelStreamState(`${i}`), () => {})
    realtime.start()
    await vi.waitFor(() => {
      expect(server.open).toHaveLength(2)
      expect(server.open.map((s) => s.topics.size).sort((a, b) => a - b)).toEqual([10, 50])
    })
    // LISTEN goes out in chunks of 20 topics.
    const sizes = server.open.flatMap((s) =>
      s.frames.filter((f) => f.type === 'LISTEN').map((f) => f.data?.topics?.length)
    )
    expect(sizes.sort()).toEqual([10, 10, 20, 20])
  })

  it('refuses topics beyond the pool limit', () => {
    const realtime = createPubSub({
      url: server.url,
      connect: (url) => new WebSocket(url),
      accessToken: async () => 't',
      scheduler: systemScheduler,
      logger: testLogger(),
      maxConnections: 1,
      topicsPerConnection: 2
    })
    realtime.subscribe('a.1', () => {})
    realtime.subscribe('a.2', () => {})
    expect(() => realtime.subscribe('a.3', () => {})).toThrow(TooManyTopicsError)
  })

  it('unlistens when the last handler for a topic goes away', async () => {
    const realtime = create()
    const offA = realtime.subscribe('topic.1', () => {})
    const offB = realtime.subscribe('topic.1', () => {})
    realtime.subscribe('topic.2', () => {})
    realtime.start()
    await vi.waitFor(() => expect(server.open[0]?.topics.size).toBe(2))

    offA()
    await new Promise((r) => setTimeout(r, 50))
    expect(server.open[0]?.topics.has('topic.1')).toBe(true)
    offB()
    await vi.waitFor(() => expect([...server.open[0]!.topics]).toEqual(['topic.2']))
  })

  it('reconnects and re-listens after the server drops the connection', async () => {
    const realtime = create()
    const handler = vi.fn()
    realtime.subscribe('topic.1', handler)
    realtime.start()
    await vi.waitFor(() => expect(server.open[0]?.topics.has('topic.1')).toBe(true))

    server.open[0]!.socket.terminate()
    await vi.waitFor(() => {
      expect(server.sockets).toHaveLength(2)
      expect(server.open[0]?.topics.has('topic.1')).toBe(true)
    })
    server.publish('topic.1', { after: 'reconnect' })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ after: 'reconnect' }))
  })

  it('reconnects when the server sends RECONNECT', async () => {
    const realtime = create()
    realtime.subscribe('topic.1', () => {})
    realtime.start()
    await vi.waitFor(() => expect(server.open).toHaveLength(1))
    server.open[0]!.socket.send(JSON.stringify({ type: 'RECONNECT' }))
    await vi.waitFor(() => expect(server.sockets).toHaveLength(2))
  })

  it('reconnects when a PONG does not arrive in time, and stays put when it does', async () => {
    const realtime = create({ pingIntervalMs: 100, pongTimeoutMs: 50 })
    realtime.subscribe('topic.1', () => {})
    realtime.start()
    await vi.waitFor(() => expect(server.open).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 300))
    expect(server.sockets).toHaveLength(1)
    expect(server.sockets[0]!.frames.filter((f) => f.type === 'PING').length).toBeGreaterThan(1)

    server.answerPings = false
    await vi.waitFor(() => expect(server.sockets.length).toBeGreaterThan(1), { timeout: 2000 })
  })

  it('reports connection status', async () => {
    const realtime = create()
    const statuses: string[] = []
    realtime.onStatus((all) => statuses.push(all.map((c) => `${c.index}:${c.state}`).join(',')))
    realtime.subscribe('topic.1', () => {})
    realtime.start()
    await vi.waitFor(() => expect(statuses).toContain('0:connected'))
    await realtime.stop()
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('0:stopped'))
  })

  it('stays disconnected after stop', async () => {
    const realtime = create()
    realtime.subscribe('topic.1', () => {})
    realtime.start()
    await vi.waitFor(() => expect(server.open).toHaveLength(1))
    await realtime.stop()
    await new Promise((r) => setTimeout(r, 200))
    expect(server.open).toHaveLength(0)
    expect(server.sockets).toHaveLength(1)
  })
})
