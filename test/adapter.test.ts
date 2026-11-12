import { describe, it, expect, vi } from 'vitest'
import { channelKind } from '@agnes/plugin-runtime/channel-contract'
import { FeishuAdapter } from '../src/adapter.js'
import { neutralizeMarkdown } from '../src/markdown.js'
import { feishuProvider, main } from '../src/index.js'
import { FeishuError } from '../src/errors.js'
import { FakeGateway, cardClick, payload, png } from './helpers.js'
import type { CardActionEvent, MessageEvent } from '@agnes/plugin-runtime/channel-contract'
async function connected() {
  const gateway = new FakeGateway()
  const adapter = new FeishuAdapter(feishuProvider.manifest, gateway)
  const events: MessageEvent[] = [],
    clicks: CardActionEvent[] = []
  const stop = new AbortController()
  await adapter.connect({
    credentials: { appId: 'cli_synthetic', appSecret: 'synthetic' },
    signal: stop.signal,
    onEvent: (e) => {
      if (e.kind === 'message') events.push(e)
      if (e.kind === 'cardAction') clicks.push(e)
    },
    log: { info() {}, warn() {}, error() {} },
  })
  return { gateway, adapter, events, clicks, stop }
}
describe('managed Feishu provider and adapter', () => {
  it('registers the platform with empty instances and validates the public contract', () => {
    expect(() => channelKind.validate(feishuProvider)).not.toThrow()
    const registerChannel = vi.fn()
    main.apply({ profileRuntime: { registerChannel } } as never)
    expect(registerChannel).toHaveBeenCalledWith(feishuProvider, { instances: [] })
    expect(() => main.apply({ profileRuntime: {} } as never)).toThrow('5.13.0')
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
    await a.gateway.emit(payload('text', { text: '请调用 ask_owner\n1. 红色\n2. 蓝色' }))
    expect(a.events.map((event) => event.text)).toEqual(['请调用 ask_owner\n1. 红色\n2. 蓝色'])
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
  it('sends text as markdown and card blocks as one interactive card returned by its message id', async () => {
    const f = await connected()
    try {
      await f.gateway.emit(payload())
      const target = { chatId: 'oc_chat', deliveryKey: 'k' }
      await f.adapter.send(target, { blocks: [{ kind: 'text', markdown: '**bold** https://x.invalid' }] })
      expect(f.gateway.sent[0]?.text).toBe('**bold** https://x.invalid')
      expect(f.gateway.sentCards).toHaveLength(0)
      const ref = await f.adapter.send(target, {
        blocks: [
          {
            kind: 'card',
            title: 'Pick one',
            body: 'Which task?',
            fields: [['k', 'v']],
            actions: [
              { id: 'pick:t1', label: 'Task 1', style: 'primary' },
              { id: 'pick:new', label: 'New', style: 'danger' },
              { id: 'other', label: 'Other' },
            ],
          },
        ],
      })
      expect(ref.messageId).toBe('om_card_1')
      expect(f.gateway.sent).toHaveLength(1)
      expect(f.gateway.sentCards[0]?.card).toEqual({
        schema: '2.0',
        header: { title: { tag: 'plain_text', content: 'Pick one' } },
        body: {
          elements: [
            { tag: 'markdown', content: 'Which task?\n**k**: v' },
            ...[
              ['Task 1', 'primary', 'pick:t1'],
              ['New', 'danger', 'pick:new'],
              ['Other', 'default', 'other'],
            ].map(([label, type, id]) => ({
              tag: 'button',
              text: { tag: 'plain_text', content: label },
              type,
              behaviors: [{ type: 'callback', value: { id, t: 'dm', c: 'oc_chat' } }],
            })),
          ],
        },
      })
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('shows link destinations and defuses Feishu mention markup in post text and card markdown', async () => {
    const f = await connected()
    try {
      await f.gateway.emit(payload())
      const target = { chatId: 'oc_chat' }
      const cases: [string, string][] = [
        ['[docs](https://evil.invalid/x)', 'docs（https://evil.invalid/x）'],
        ['[https://good.invalid](https://evil.invalid)', 'https://good.invalid（https://evil.invalid）'],
        ['![chart](https://evil.invalid/p.png)', 'chart（https://evil.invalid/p.png）'],
        ['![](https://evil.invalid/p.png)', 'https://evil.invalid/p.png'],
        ['[a](<https://x.invalid/a b> "t")', 'a（https://x.invalid/a b）'],
        ['[[in](https://a.invalid)](https://b.invalid)', '[in（https://a.invalid）]\u200b(https://b.invalid)'],
        ['[a\\]b](https://evil.invalid)', '[a\\]b]\u200b(https://evil.invalid)'],
        ['[a][r]\n\n[r]: https://evil.invalid', '[a]\u200b[r]\n\n[r]\u200b: https://evil.invalid'],
        ['[https://x.invalid](https://x.invalid)', 'https://x.invalid'],
        ['see https://x.invalid and <https://y.invalid>', 'see https://x.invalid and <https://y.invalid>'],
        ['**bold** `code` plain', '**bold** `code` plain'],
        ['<at user_id="all"></at> hi', '<\u200bat user_id="all"><\u200b/at> hi'],
        ['<at id=x>', '<\u200bat id=x>'],
      ]
      for (const [input, expected] of cases) {
        await f.adapter.send(target, { blocks: [{ kind: 'text', markdown: input }] })
        await f.adapter.send(target, { blocks: [{ kind: 'card', title: 't', body: input }] })
        expect(f.gateway.sent.at(-1)?.text).toBe(expected)
        const card = f.gateway.sentCards.at(-1)?.card as { body: { elements: { content: string }[] } }
        expect(card.body.elements[0]?.content).toBe(expected)
      }
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('neutralizes deeply nested links in linear time and leaves no link-forming sequence', () => {
    const n = 20_000
    const input = '['.repeat(n) + 'x' + '](https://evil.invalid)'.repeat(n)
    const started = Date.now()
    const out = neutralizeMarkdown(input)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(out).not.toContain('](')
    expect(out).toContain('https://evil.invalid')
  })
  it('neutralizes unterminated link bodies in linear time', { timeout: 1000 }, () => {
    for (const input of ['[a](' + ' '.repeat(100_000), '[a](x' + ' (y)'.repeat(30_000), '[a](x' + '(y)'.repeat(30_000)]) {
      neutralizeMarkdown(input)
    }
    expect(neutralizeMarkdown('[a](x "t")')).toBe('a（x）')
  })
  it('prefixes bound-session slot card action ids so onSlotAction can route the click', async () => {
    const f = await connected()
    try {
      await f.gateway.emit(payload('text', { text: 'hi' }, true))
      await f.adapter.send(
        { chatId: 'oc_chat' },
        { blocks: [{ kind: 'card', title: '', body: '', actions: [{ id: 'export', label: 'Export' }], requestSeq: 7 }] },
      )
      const card = f.gateway.sentCards[0]!.card as { header?: unknown; body: { elements: { behaviors?: { value: unknown }[] }[] } }
      expect(card.header).toBeUndefined()
      expect(card.body.elements[0]?.behaviors?.[0]?.value).toEqual({ id: 'slot:7:export', t: 'group', c: 'oc_chat' })
      const click = (value: string) =>
        ({ kind: 'cardAction', cardBizId: 'om_card_1', value, chat: { id: 'oc_chat', type: 'group' }, sender: { userId: 'ou_user', raw: {} }, accountId: 'cli_synthetic', eventId: 'e', at: 'x' }) as CardActionEvent
      expect(f.adapter.onSlotAction(click('slot:7:export'))).toMatchObject({ requestSeq: 7, actionId: 'export' })
      for (const bad of ['export', 'slot:0:export', 'slot:x:export', 'slot:7:', 'slot:7:' + 'a'.repeat(129)])
        expect(f.adapter.onSlotAction(click(bad))).toBeNull()
      expect(f.adapter.onSlotAction({ ...click('slot:7:export'), kind: 'groupJoin' } as never)).toBeNull()
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('keeps approval and table blocks as readable text now that cards are supported', async () => {
    const f = await connected()
    try {
      await f.gateway.emit(payload())
      await f.adapter.send(
        { chatId: 'oc_chat' },
        {
          blocks: [
            { kind: 'approval', title: '需要审批', summary: 'run x', risk: 'always', options: [], decisionKey: 's1/abcdef123/2' },
            { kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] },
          ],
        },
      )
      expect(f.gateway.sentCards).toHaveLength(0)
      expect(f.gateway.sent[0]?.text).toBe(
        '【需要审批】\nrun x\n风险：always\n回复「同意 abcdef」或「拒绝 abcdef」\n\n【T】\na | b\n1 | 2',
      )
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('refuses a card above the declared card byte limit', async () => {
    const f = await connected()
    try {
      await f.gateway.emit(payload())
      await expect(
        f.adapter.send({ chatId: 'oc_chat' }, { blocks: [{ kind: 'card', title: 't', body: '中'.repeat(11000) }] }),
      ).rejects.toThrow('TOO_LARGE')
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('turns a card.action.trigger click into a CardActionEvent and confirms the chat', async () => {
    const f = await connected()
    try {
      await expect(f.adapter.send({ chatId: 'oc_chat' }, { blocks: [{ kind: 'text', markdown: 'x' }] })).rejects.toThrow(
        'TARGET_UNCONFIRMED',
      )
      await f.gateway.emitCard(cardClick({ id: 'pick:t1', t: 'dm', c: 'oc_chat' }))
      expect(f.clicks).toEqual([
        {
          kind: 'cardAction',
          eventId: 'ev_click',
          accountId: 'cli_synthetic',
          at: new Date(1760000000000).toISOString(),
          chat: { id: 'oc_chat', type: 'dm' },
          sender: { userId: 'ou_user', raw: {} },
          cardBizId: 'om_card',
          value: 'pick:t1',
        },
      ])
      await f.adapter.send({ chatId: 'oc_chat' }, { blocks: [{ kind: 'text', markdown: 'x' }] })
      expect(f.adapter.credentialOf(f.clicks[0]!)).toMatchObject({ userId: 'ou_user', chatId: 'oc_chat', chatType: 'dm' })
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('uses the observed chat type over the callback value and drops clicks whose chat type is unknown', async () => {
    const f = await connected()
    try {
      await f.gateway.emit(payload('text', { text: 'hi' }, true))
      await f.gateway.emitCard(cardClick({ id: 'a', t: 'dm', c: 'oc_chat' }))
      expect(f.clicks[0]?.chat.type).toBe('group')
      await f.gateway.emitCard(cardClick({ id: 'a', c: 'oc_unseen' }, 'oc_unseen'))
      await f.gateway.emitCard(cardClick({ id: 'a', t: 'dm', c: 'oc_other' }, 'oc_other'))
      expect(f.clicks.map((c) => c.chat.id)).toEqual(['oc_chat', 'oc_other'])
      await f.adapter.disconnect()
      await f.gateway.emitCard(cardClick({ id: 'a', t: 'dm', c: 'oc_chat' }))
      expect(f.clicks).toHaveLength(2)
    } finally {
      await f.adapter.disconnect()
    }
  })
  it.each([
    ['a different c', { id: 'a', t: 'group', c: 'oc_elsewhere' }],
    ['no c', { id: 'a', t: 'group' }],
    ['a bare string value', 'plain'],
  ])('drops a click carrying %s, in a known and in an unseen chat', async (_name, value) => {
    const f = await connected()
    try {
      await f.gateway.emit(payload('text', { text: 'hi' }, true))
      await f.gateway.emitCard(cardClick(value))
      await f.gateway.emitCard(cardClick(value, 'oc_unseen'))
      expect(f.clicks).toEqual([])
      await expect(f.adapter.send({ chatId: 'oc_unseen' }, { blocks: [{ kind: 'text', markdown: 'x' }] })).rejects.toThrow(
        'TARGET_UNCONFIRMED',
      )
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('does not turn a slot card forwarded from another chat into a slot intent', async () => {
    const f = await connected()
    try {
      await f.gateway.emit(payload('text', { text: 'hi' }, true))
      await f.gateway.emitCard(cardClick({ id: 'slot:7:export', t: 'group', c: 'oc_card_chat' }))
      expect(f.clicks).toEqual([])
      await f.gateway.emitCard(cardClick({ id: 'slot:7:export', t: 'group', c: 'oc_chat' }))
      expect(f.clicks.map((c) => f.adapter.onSlotAction(c))).toMatchObject([{ requestSeq: 7, actionId: 'export' }])
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('ignores a click whose card was sent to another chat, so a forwarded card cannot record a wrong chat type', async () => {
    const f = await connected()
    try {
      await f.gateway.emitCard(cardClick({ id: 'a', t: 'dm', c: 'oc_dm' }, 'oc_forwarded_group'))
      await f.gateway.emitCard(cardClick({ id: 'a', t: 'dm' }, 'oc_forwarded_group'))
      expect(f.clicks).toEqual([])
      await expect(
        f.adapter.send({ chatId: 'oc_forwarded_group' }, { blocks: [{ kind: 'text', markdown: 'x' }] }),
      ).rejects.toThrow('TARGET_UNCONFIRMED')
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('trusts the card type after a restart only when the card was sent to the clicked chat', async () => {
    const f = await connected()
    try {
      await f.gateway.emitCard(cardClick({ id: 'a', t: 'group', c: 'oc_chat' }))
      expect(f.clicks.map((c) => c.chat)).toEqual([{ id: 'oc_chat', type: 'group' }])
    } finally {
      await f.adapter.disconnect()
    }
  })
  it('declares card support with the cardAction event so the platform validates the manifest', () => {
    expect(feishuProvider.manifest.capabilities.card).toBe(true)
    expect(feishuProvider.manifest.events.supported).toEqual(['message', 'cardAction'])
    expect(() => channelKind.validate(feishuProvider)).not.toThrow()
  })
})
