import { queuedMessageHandler } from '../src/sdk-socket.js'
import { describe, it, expect, vi } from 'vitest'
import { RealGateway } from '../src/gateway.js'
import type { SocketFactory, SocketOptions } from '../src/sdk-socket.js'
import { png } from './helpers.js'
function fixture(
  options: {
    redirect?: boolean
    limit?: boolean
    notReady?: boolean
    domain?: 'feishu' | 'lark'
    apiError?: boolean
  } = {},
) {
  const calls: { url: string; init: RequestInit }[] = []
  let socketOptions!: SocketOptions
  const close = vi.fn()
  let handler: unknown
  const socketFactory: SocketFactory = (value) => {
    socketOptions = value
    return {
      start: async (callback) => {
        handler = callback
        if (!options.notReady) value.onReady()
      },
      close,
    }
  }
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    if (url.includes('tenant_access_token'))
      return Response.json({ code: 0, tenant_access_token: 'synthetic-token', expire: 7200 })
    if (url.endsWith('/bot/v3/info')) return Response.json({ code: 0, bot: { open_id: 'ou_bot' } })
    if (url.includes('/resources/'))
      return options.redirect
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://attacker.invalid/?secret=hidden' },
          })
        : new Response(png, {
            headers: {
              'content-type': 'image/png',
              'content-length': String(options.limit ? 100000 : png.length),
            },
          })
    if (url.includes('/messages?'))
      return Response.json(
        options.apiError
          ? { code: 999, msg: 'synthetic-secret-must-not-leak' }
          : { code: 0, data: { message_id: 'om_sent' } },
      )
    return Response.json({ code: 999, msg: 'synthetic-secret-must-not-leak' })
  }) as typeof fetch
  const gateway = new RealGateway({ fetchImpl, socketFactory })
  const stop = new AbortController()
  const start = () =>
    gateway.start(
      { appId: 'cli_synthetic', appSecret: 'synthetic' },
      options.domain ?? 'feishu',
      async () => {},
      stop.signal,
    )
  return {
    gateway,
    stop,
    start,
    calls,
    close,
    get socketOptions() {
      return socketOptions
    },
  }
}
describe('Feishu HTTP and official WS lifecycle boundary', () => {
  it.each(['feishu', 'lark'] as const)(
    'authenticates to the fixed %s origin and downloads real bounded bytes',
    async (domain) => {
      const f = fixture({ domain })
      try {
        expect(await f.start()).toEqual({ botId: 'ou_bot' })
        const result = await f.gateway.download(
          'om/1',
          { key: 'img/2', kind: 'image', name: 'image.png', mime: 'image/png' },
          1024,
        )
        expect(result.bytes).toEqual(new Uint8Array(png))
        expect(f.calls.filter((x) => x.url.includes('tenant_access_token'))).toHaveLength(1)
        const call = f.calls.find((x) => x.url.includes('/resources/'))!
        expect(call.url).toContain('/messages/om%2F1/resources/img%2F2?type=image')
        expect(call.init.redirect).toBe('manual')
        expect(
          call.url.startsWith(
            domain === 'feishu' ? 'https://open.feishu.cn/' : 'https://open.larksuite.com/',
          ),
        ).toBe(true)
        expect(await f.gateway.send('oc_chat', 'hello', 'stable-uuid')).toBe('om_sent')
        expect(JSON.parse(f.calls.at(-1)!.init.body as string)).toMatchObject({
          receive_id: 'oc_chat',
          uuid: 'stable-uuid',
          content: '{"text":"hello"}',
        })
      } finally {
        await f.gateway.stop()
      }
    },
  )
  it('refuses media redirects without sending a token to another origin', async () => {
    const f = fixture({ redirect: true })
    try {
      await f.start()
      await expect(
        f.gateway.download('om', { key: 'img', kind: 'image', name: 'x', mime: 'image/png' }, 1024),
      ).rejects.toMatchObject({ reason: 'REDIRECT' })
      expect(f.calls.some((x) => x.url.includes('attacker.invalid'))).toBe(false)
    } finally {
      await f.gateway.stop()
    }
  })
  it('refuses encoded-dot resource path traversal before making a resource request', async () => {
    const f = fixture()
    try {
      await f.start()
      await expect(
        f.gateway.download('..', { key: '.', kind: 'image', name: 'x', mime: 'image/png' }, 1024),
      ).rejects.toMatchObject({ reason: 'RESPONSE' })
      expect(f.calls.some((x) => x.url.includes('/resources/'))).toBe(false)
    } finally {
      await f.gateway.stop()
    }
  })
  it('refuses oversized media before reading its body', async () => {
    const f = fixture({ limit: true })
    try {
      await f.start()
      await expect(
        f.gateway.download('om', { key: 'img', kind: 'image', name: 'x', mime: 'image/png' }, 1024),
      ).rejects.toMatchObject({ reason: 'LIMIT' })
    } finally {
      await f.gateway.stop()
    }
  })
  it('gates sends during reconnect and disables a retired connection', async () => {
    const f = fixture()
    await f.start()
    f.socketOptions.onReconnecting()
    await expect(f.gateway.send('oc', 'text', 'uuid')).rejects.toMatchObject({ reason: 'NOT_CONNECTED' })
    f.socketOptions.onReconnected()
    expect(await f.gateway.send('oc', 'text', 'uuid')).toBe('om_sent')
    await f.gateway.stop()
    expect(f.close).toHaveBeenCalled()
    expect(f.gateway.ready).toBe(false)
    f.socketOptions.onReconnected()
    expect(f.gateway.ready).toBe(false)
  })
  it('cancels an in-flight handshake, closes the socket and clears its deadline', async () => {
    const f = fixture({ notReady: true })
    const starting = f.start()
    const failure = expect(starting).rejects.toMatchObject({ reason: 'CANCELLED' })
    await vi.waitFor(() => expect(f.socketOptions).toBeDefined())
    f.stop.abort()
    await failure
    expect(f.close).toHaveBeenCalled()
    expect(f.gateway.ready).toBe(false)
  })
  it('masks platform response bodies and does not reuse a token after stop', async () => {
    const f = fixture({ apiError: true })
    await f.start()
    await expect(f.gateway.send('oc', 'hello', 'id')).rejects.toThrow('Feishu API (999)')
    await expect(f.gateway.send('oc', 'hello', 'id')).rejects.not.toThrow('synthetic-secret-must-not-leak')
    await f.gateway.stop()
    await f.start()
    expect(f.calls.filter((x) => x.url.includes('tenant_access_token'))).toHaveLength(2)
    await f.gateway.stop()
  })
})

it('does not send with a retired cached token after cancellation', async () => {
  const f = fixture()
  await f.start()
  const sending = f.gateway.send('oc', 'hello', 'id')
  const refused = expect(sending).rejects.toMatchObject({ reason: 'CANCELLED' })
  await f.gateway.stop()
  await refused
  expect(f.calls.some((x) => x.url.includes('/messages?'))).toBe(false)
})
it('clears the handshake deadline even if socket construction throws synchronously', async () => {
  vi.useFakeTimers()
  const gateway = new RealGateway({
    fetchImpl: async (input) =>
      String(input).includes('tenant_access_token')
        ? Response.json({ code: 0, tenant_access_token: 'synthetic', expire: 7200 })
        : Response.json({ code: 0, bot: { open_id: 'ou_bot' } }),
    socketFactory: () => {
      throw new Error('secret must not leak')
    },
  })
  try {
    await expect(
      gateway.start(
        { appId: 'cli_synthetic', appSecret: 'synthetic' },
        'feishu',
        async () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('Feishu CONNECT')
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    await gateway.stop()
    vi.useRealTimers()
  }
})

it('acknowledges queued messages without waiting for slow media work', async () => {
  let release!: () => void
  let finished = false
  const work = new Promise<void>(
    (resolve) =>
      (release = () => {
        finished = true
        resolve()
      }),
  )
  const callback = queuedMessageHandler(() => work)
  await expect(callback({})).resolves.toEqual({})
  expect(finished).toBe(false)
  release()
  await work
  expect(finished).toBe(true)
})
it('does not acknowledge synchronous queue refusal and absorbs asynchronous processing errors', async () => {
  await expect(
    queuedMessageHandler(() => {
      throw new Error('queue full')
    })({}),
  ).rejects.toThrow('queue full')
  await expect(
    queuedMessageHandler(() => Promise.reject(new Error('synthetic secret')))({}),
  ).resolves.toEqual({})
})
