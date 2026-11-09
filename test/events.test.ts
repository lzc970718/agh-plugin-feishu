import { describe, it, expect } from 'vitest'
import { normalize, safeName } from '../src/events.js'
import { payload } from './helpers.js'
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
  it('only strips verified bot mentions and preserves mentions of other users', () => {
    const raw = payload('text', { text: '@_user_1 hello @_user_2' }, true)
    raw.message.mentions = [
      { key: '@_user_1', id: { open_id: 'ou_bot' } },
      { key: '@_user_2', id: { open_id: 'ou_other' } },
    ] as never
    const result = normalize(raw, 'app', 'ou_bot')!
    expect(result.event.text).toBe('hello @_user_2')
    expect(result.event.mentions.bot).toBe(true)
    expect(
      normalize(payload('text', { text: '@bot hello' }, true), 'app', 'ou_bot')?.event.mentions.bot,
    ).toBe(false)
  })
  it('refuses application senders and malformed identities, content or timestamps', () => {
    const bot = payload()
    bot.sender.sender_type = 'app'
    expect(normalize(bot, 'app', 'bot')).toBeNull()
    for (const raw of [
      {},
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
})
