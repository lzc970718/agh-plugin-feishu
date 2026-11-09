import { describe, it, expect, vi } from 'vitest'
import { channelKind } from '@agnes/plugin-runtime/channel-contract'
import { FeishuAdapter } from '../src/adapter.js'
import { feishuProvider, main } from '../src/index.js'
import { FeishuError } from '../src/errors.js'
import { FakeGateway, payload, png } from './helpers.js'
import type { MessageEvent } from '@agnes/plugin-runtime/channel-contract'
async function connected() {
  const gateway = new FakeGateway()
  const adapter = new FeishuAdapter(feishuProvider.manifest, gateway)
  const events: MessageEvent[] = []
  const stop = new AbortController()
  await adapter.connect({
    credentials: { appId: 'cli_synthetic', appSecret: 'synthetic' },
    signal: stop.signal,
    onEvent: (e) => {
      if (e.kind === 'message') events.push(e)
    },
    log: { info() {}, warn() {}, error() {} },
  })
  return { gateway, adapter, events, stop }
}
describe('managed Feishu provider and adapter', () => {
  it('registers the platform with empty instances and validates the public contract', () => {
    expect(() => channelKind.validate(feishuProvider)).not.toThrow()
    const registerChannel = vi.fn()
    main.apply({ profileRuntime: { registerChannel } } as never)
    expect(registerChannel).toHaveBeenCalledWith(feishuProvider, { instances: [] })
    expect(() => main.apply({ profileRuntime: {} } as never)).toThrow('5.8.0')
  })
  it.each([null, [], { appSecret: 'secret' }, { domain: 'https://attacker.invalid' }])(
    'refuses unsupported or sensitive instance config',
    (config) => {
      expect(() => feishuProvider.create({ config: config as never })).toThrow()
    },
  )
  it('stores actual images, video and documents and preserves partial failure notices without secrets', async () => {
    const f = await connected()
    try {
      f.gateway.downloads.set('img', { bytes: png, mime: 'image/png' })
      f.gateway.downloads.set('file', { bytes: new Uint8Array([1, 2, 3]), mime: 'video/mp4' })
      f.gateway.downloads.set('bad', new Error('synthetic-secret-must-not-leak'))
      await f.gateway.emit(
        payload('post', {
          content: [
            [
              { tag: 'text', text: 'hello' },
              { tag: 'img', image_key: 'img' },
              { tag: 'media', file_key: 'file' },
              { tag: 'img', image_key: 'bad' },
            ],
          ],
        }),
      )
      const intent = f.adapter.toSession(f.events[0]!, { tenant: 'tenant', agent: 'default' })!
      expect(intent.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('附件未能同步') }),
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
        { type: 'file', name: 'video.mp4', data: 'AQID', mimeType: 'video/mp4' },
      ])
      expect(JSON.stringify(intent)).not.toContain('synthetic-secret-must-not-leak')
      expect(JSON.stringify(intent)).not.toContain('attachment://')
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('keeps attachment-only messages and safe text when downloads fail', async () => {
    const f = await connected()
    try {
      f.gateway.downloads.set('file', { bytes: new Uint8Array([1]), mime: 'application/octet-stream' })
      await f.gateway.emit(payload('file', { file_key: 'file', file_name: 'a.txt' }))
      expect(f.adapter.toSession(f.events[0]!, { tenant: 't', agent: 'a' })?.content[0]?.type).toBe('file')
      await f.gateway.emit(payload('image', { image_key: 'missing' }))
      expect(f.events[1]?.text).toContain('DOWNLOAD_FAILED')
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('sends new AGH text to confirmed chats and uses stable per-part delivery ids', async () => {
    const f = await connected()
    try {
      await expect(
        f.adapter.send({ chatId: 'other' }, { blocks: [{ kind: 'text', markdown: 'hello' }] }),
      ).rejects.toThrow('TARGET_UNCONFIRMED')
      await f.gateway.emit(payload())
      const target = { chatId: 'oc_chat', deliveryKey: 'stable-key' },
        message = { blocks: [{ kind: 'text' as const, markdown: '中'.repeat(9000) }] }
      expect(await f.adapter.send(target, message)).toMatchObject({
        chatId: 'oc_chat',
        messageId: 'om_sent_2',
      })
      await f.adapter.send(target, message)
      expect(f.gateway.sent.map((x) => x.uuid).slice(0, 2)).toEqual(
        f.gateway.sent.map((x) => x.uuid).slice(2),
      )
      expect(f.gateway.sent[0]?.text.length).toBe(8000)
      expect(f.gateway.sent[1]?.text.length).toBe(1000)
      expect(f.adapter.onApprovalAction({} as never)).toBeNull()
      await expect(f.adapter.update({ chatId: 'oc_chat', messageId: 'x' }, message)).rejects.toThrow(
        'EDIT_UNSUPPORTED',
      )
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('isolates instances and ignores retired callbacks after disconnect and credential replacement', async () => {
    const a = await connected(),
      b = await connected()
    const old = a.gateway.handler!
    await a.gateway.emit(payload())
    expect(b.events).toHaveLength(0)
    await a.adapter.disconnect()
    await old(payload())
    expect(a.events).toHaveLength(1)
    await a.adapter.connect({
      credentials: { appId: 'cli_replacement', appSecret: 'new' },
      signal: a.stop.signal,
      onEvent: (e) => {
        if (e.kind === 'message') a.events.push(e)
      },
      log: { info() {}, warn() {}, error() {} },
    })
    await old(payload())
    expect(a.events).toHaveLength(1)
    await a.gateway.emit(payload())
    expect(a.events[1]?.accountId).toBe('cli_replacement')
    await a.adapter.disconnect()
    await b.adapter.disconnect()
  })
  it('drains an aborted media task without emitting a stale event', async () => {
    const f = await connected()
    let release!: () => void
    f.gateway.download = async () => {
      await new Promise<void>((r) => (release = r))
      return { bytes: png, mime: 'image/png' }
    }
    const delivery = f.gateway.emit(payload('image', { image_key: 'img' }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const stopped = f.adapter.disconnect()
    release()
    await Promise.all([delivery, stopped])
    expect(f.events).toHaveLength(0)
  })
})
