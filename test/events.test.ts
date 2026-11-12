import { describe, it, expect, vi } from 'vitest'
import { normalize, normalizeCardAction, safeName } from '../src/events.js'
import { cardClick, payload } from './helpers.js'
describe('Feishu event normalization', () => {
  it.each(['text', 'image', 'file', 'audio', 'media', 'sticker', 'post'])(
    'normalizes %s and preserves stable identifiers',
    (type) => {
      const values: Record<string, unknown> = {
        text: { text: 'hello' },
        image: { image_key: 'img' },
        file: { file_key: 'file', file_name: 'report.pdf' },
        audio: { file_key: 'audio' },
        media: { file_key: 'video' },
        sticker: { file_key: 'sticker' },
        post: {
          zh_cn: {
            title: 'Title',
            content: [
              [
                { tag: 'text', text: 'hello' },
                { tag: 'img', image_key: 'img' },
              ],
            ],
          },
        },
      }
      const input = payload(type, values[type])
      const result = normalize(input, 'cli_app', 'ou_bot')!
      expect(result.event).toMatchObject({
        eventId: 'om_message',
        messageId: 'om_message',
        accountId: 'cli_app',
        at: '2025-10-09T08:53:20.000Z',
        chat: { id: 'oc_chat', type: 'dm' },
        sender: { userId: 'ou_user' },
      })
      if (type !== 'text') expect(result.media).toHaveLength(1)
      expect(
        normalize(
          { event: { ...input, message: { ...input.message, content: values[type] } } },
          'cli_app',
          'ou_bot',
        ),
      ).toEqual(result)
    },
  )
  it.each(['hello', '第一行\n第二行', '第一行\r\n第二行', '名称\t内容'])(
    'only strips verified bot mentions and preserves message text %j and other users',
    (text) => {
      const raw = payload('text', { text: `@_user_1 ${text} @_user_2` }, true)
      raw.message.mentions = [
        { key: '@_user_1', id: { open_id: 'ou_bot' } },
        { key: '@_user_2', id: { open_id: 'ou_other' } },
      ] as never
      const result = normalize(raw, 'app', 'ou_bot')!
      expect(result.event.text).toBe(`${text} @_user_2`)
      expect(result.event.mentions.bot).toBe(true)
      expect(
        normalize(payload('text', { text: '@bot hello' }, true), 'app', 'ou_bot')?.event.mentions.bot,
      ).toBe(false)
    },
  )
  it('refuses application senders and malformed identities, content or timestamps', () => {
    const bot = payload()
    bot.sender.sender_type = 'app'
    expect(normalize(bot, 'app', 'bot')).toBeNull()
    for (const raw of [
      {},
      ...[null, 7, '', 'x'.repeat(60001), 'bad\u0000text', 'bad\u000btext', 'bad\u007ftext'].map((text) => payload('text', { text })),
      ...['bad\nidentity', 'bad\ridentity', 'bad\tidentity'].map((open_id) => ({
        ...payload(), sender: { sender_type: 'user', sender_id: { open_id } },
      })),
      { ...payload(), message: { ...payload().message, create_time: 'bad' } },
      { ...payload(), message: { ...payload().message, content: '[]' } },
      { ...payload(), sender: { sender_type: 'user', sender_id: { open_id: '' } } },
    ])
      expect(() => normalize(raw, 'app', 'bot')).toThrow()
  })
  it('sanitizes filenames and caps resource lists without losing text', () => {
    expect(safeName('../../dir/private\\report.pdf', 'file')).toBe('report.pdf')
    const result = normalize(
      payload('post', {
        content: [
          [
            { tag: 'text', text: 'safe' },
            ...Array.from({ length: 60 }, (_, i) => ({ tag: 'img', image_key: 'img' + i })),
          ],
        ],
      }),
      'app',
      'bot',
    )!
    expect(result.media).toHaveLength(51)
    expect(result.event.text).toBe('safe')
  })
  it('carries the quoted message id from parent_id and omits it otherwise', () => {
    const quoted = payload()
    ;(quoted.message as Record<string, unknown>).parent_id = 'om_parent'
    expect(normalize(quoted, 'cli_app', 'ou_bot')!.event).toMatchObject({ quotedMessageId: 'om_parent' })
    expect(normalize(payload(), 'cli_app', 'ou_bot')!.event).not.toHaveProperty('quotedMessageId')
    ;(quoted.message as Record<string, unknown>).parent_id = 'bad\u0000id'
    expect(normalize(quoted, 'cli_app', 'ou_bot')!.event).not.toHaveProperty('quotedMessageId')
  })
  it('normalizes card.action.trigger in the SDK-flattened and the nested shape', () => {
    const expected = {
      chatId: 'oc_chat',
      messageId: 'om_card',
      userId: 'ou_user',
      value: 'pick:1',
      chatType: 'dm',
      eventId: 'ev_click',
      at: '2026-11-12T05:44:46.906Z',
    }
    expect(normalizeCardAction({ ...cardClick(), create_time: '1794462286906375' })).toMatchObject(expected)
    const flat = cardClick()
    expect(
      normalizeCardAction({
        schema: '2.0',
        header: { event_id: 'ev_click', event_type: 'card.action.trigger', create_time: '1794462286906375' },
        event: { operator: flat.operator, action: flat.action, context: flat.context },
      }),
    ).toMatchObject(expected)
    expect(normalizeCardAction(cardClick({ id: 'x', t: 'dm', c: 'oc_chat' }))).toMatchObject({ cardChatId: 'oc_chat' })
    expect(normalizeCardAction(cardClick({ id: 'x', t: 'dm', c: 'a'.repeat(300) }))).not.toHaveProperty('cardChatId')
  })
  it.each([undefined, 'bad', '0', '-1', '1e30'])('uses the current time for invalid card timestamp %j', (create_time) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-12T05:44:46.000Z'))
      expect(normalizeCardAction({ ...cardClick(), create_time })?.at).toBe('2026-11-12T05:44:46.000Z')
    } finally {
      vi.useRealTimers()
    }
  })
  it.each([{}, { id: '' }, { id: 5 }, 7, null, 'plain-id'])('drops a card click with an unusable value %j', (value) => {
    expect(normalizeCardAction(cardClick(value))).toBeNull()
  })
})

it('bounds submitted form values and requires a callback event id for platform decisions', () => {
  const click = cardClick({ id: 'surface:payload', t: 'dm', c: 'oc_chat' })
  const valid = { ...click, action: { ...click.action, form_value: { f0: '你好\n世界', f1: ['a', 'b'] } } }
  expect(normalizeCardAction(valid)?.formValues).toEqual({ f0: '你好\n世界', f1: ['a', 'b'] })
  expect(normalizeCardAction({ ...valid, event_id: undefined })).toBeNull()
  expect(normalizeCardAction({ ...valid, action: { ...valid.action, form_value: { f0: ['x'.repeat(10001)] } } })).toBeNull()
  expect(normalizeCardAction({ ...valid, action: { ...valid.action, form_value: { f0: { injected: true } } } })).toBeNull()
})
