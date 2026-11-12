import { createHash } from 'node:crypto'
import type { MessageEvent } from '@agnes/plugin-runtime/channel-contract'
import type { Media } from './contracts.js'
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024
export const MAX_MEDIA_COUNT = 50
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Feishu object')
  return value as Record<string, unknown>
}
export function required(value: unknown, max = 256): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new Error('Invalid Feishu field')
  return value
}
function optional(value: unknown, max: number): string | undefined {
  try {
    return required(value, max)
  } catch {
    return undefined
  }
}
export function safeName(value: unknown, fallback: string): string {
  const source = typeof value === 'string' ? value.replaceAll('\\', '/').split('/').at(-1) : undefined
  return (
    [...(source ?? fallback)]
      .filter((char) => {
        const n = char.charCodeAt(0)
        return n > 31 && n !== 127
      })
      .slice(0, 256)
      .join('')
      .trim() || fallback
  )
}
export type Incoming = { event: MessageEvent; media: Media[] }
export function normalize(input: unknown, appId: string, botId: string): Incoming | null {
  const envelope = record(input),
    data = record(envelope.event ?? envelope)
  const sender = record(data.sender)
  if (sender.sender_type !== 'user') return null
  const who = record(sender.sender_id),
    message = record(data.message)
  if (message.chat_type !== 'p2p' && message.chat_type !== 'group') return null
  const id = required(message.message_id, 512),
    chat = required(message.chat_id),
    user = required(who.open_id)
  const raw = message.content
  const content =
    typeof raw === 'string'
      ? raw.length <= 262144
        ? record(JSON.parse(raw))
        : (() => {
            throw new Error('Content too large')
          })()
      : record(raw)
  const mentions = Array.isArray(message.mentions) ? message.mentions.slice(0, 100).map(record) : []
  const botMentions = mentions.filter((mention) => {
    try {
      return record(mention.id).open_id === botId
    } catch {
      return false
    }
  })
  const strip = (text: string) =>
    botMentions.reduce(
      (out, mention) => (typeof mention.key === 'string' ? out.split(mention.key).join('') : out),
      text,
    )
  const media: Media[] = [],
    texts: string[] = []
  const add = (key: unknown, kind: 'image' | 'file', name: unknown, mime: string) => {
    if (media.length >= MAX_MEDIA_COUNT + 1) return
    media.push({
      key: required(key, 1024),
      kind,
      name: safeName(name, kind === 'image' ? 'image.png' : 'attachment'),
      mime,
    })
  }
  switch (message.message_type) {
    case 'text': {
      const text = content.text
      if (
        typeof text !== 'string' ||
        !text.length ||
        text.length > 60000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
      )
        throw new Error('Invalid Feishu text')
      texts.push(text)
      break
    }
    case 'image':
      add(content.image_key, 'image', 'image.png', 'application/octet-stream')
      break
    case 'file':
      add(content.file_key, 'file', content.file_name, 'application/octet-stream')
      break
    case 'audio':
      add(content.file_key, 'file', 'audio.ogg', 'audio/ogg')
      break
    case 'media':
      add(content.file_key, 'file', content.file_name ?? 'video.mp4', 'video/mp4')
      break
    case 'sticker':
      add(content.file_key, 'file', 'sticker.webp', 'image/webp')
      break
    case 'post': {
      const post = Array.isArray(content.content)
        ? content
        : record(content.zh_cn ?? content.en_us ?? Object.values(content)[0])
      if (typeof post.title === 'string') texts.push(post.title)
      if (!Array.isArray(post.content) || post.content.length > 256) throw new Error('Invalid Feishu post')
      for (const row of post.content) {
        if (!Array.isArray(row) || row.length > 256) throw new Error('Invalid Feishu post row')
        let line = ''
        for (const rawPart of row) {
          const part = record(rawPart)
          if ((part.tag === 'text' || part.tag === 'a' || part.tag === 'md') && typeof part.text === 'string')
            line += part.text
          else if (part.tag === 'img') add(part.image_key, 'image', 'image.png', 'application/octet-stream')
          else if (part.tag === 'media') add(part.file_key, 'file', 'video.mp4', 'video/mp4')
          else if (part.tag === 'at' && part.user_id !== botId)
            line += '@' + (typeof part.user_name === 'string' ? part.user_name : '用户')
        }
        texts.push(line)
      }
      break
    }
    default:
      texts.push('[飞书消息类型暂不支持：' + String(message.message_type).slice(0, 32) + ']')
  }
  const time = Number(message.create_time)
  if (!Number.isFinite(time) || time < 0 || time > 8.64e15) throw new Error('Invalid Feishu time')
  const quoted = optional(message.parent_id, 512)
  return {
    event: {
      kind: 'message',
      eventId: id,
      messageId: id,
      accountId: appId,
      at: new Date(time).toISOString(),
      chat: { id: chat, type: message.chat_type === 'p2p' ? 'dm' : 'group' },
      sender: { userId: user, raw: {} },
      text: strip(texts.join('\n')).trim(),
      attachments: [],
      mentions: { bot: botMentions.length > 0, replyToBot: false, quoteBot: false },
      ...(quoted ? { quotedMessageId: quoted } : {}),
    },
    media,
  }
}
export type CardClick = {
  eventId: string
  appId?: string
  chatId: string
  messageId: string
  userId: string
  value: string
  chatType?: 'dm' | 'group'
  cardChatId?: string
  formValues?: Record<string, string | string[]>
  at: string
}
/**
 * Accepts the SDK-flattened `card.action.trigger` event (header and event fields at one level) and the
 * nested `{ header, event }` form. Our buttons carry `{ id, t, c }`; any other value shape is dropped.
 */
export function normalizeCardAction(input: unknown): CardClick | null {
  const envelope = record(input),
    data = record(envelope.event ?? envelope)
  const header = envelope.header && typeof envelope.header === 'object' ? record(envelope.header) : {}
  const context = data.context ? record(data.context) : {}
  const messageId = optional(context.open_message_id ?? data.open_message_id, 512),
    chatId = optional(context.open_chat_id ?? data.open_chat_id, 256),
    userId = optional(record(data.operator ?? {}).open_id, 256)
  if (!messageId || !chatId || !userId) return null
  const action = record(data.action ?? {})
  const raw = action.value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const object = raw as Record<string, unknown>,
    value = optional(object.id, 1024),
    chatType = object.t === 'dm' || object.t === 'group' ? object.t : undefined,
    cardChatId = optional(object.c, 256)
  if (!value) return null
  let formValues: Record<string, string | string[]> | undefined
  if (action.form_value !== undefined) {
    const form = record(action.form_value)
    const entries = Object.entries(form)
    if (entries.length > 64) return null
    formValues = Object.create(null) as Record<string, string | string[]>
    let size = 0
    for (const [key, item] of entries) {
      if (!optional(key, 256)) return null
      const values = Array.isArray(item) ? item : [item]
      if (values.length > 100 || values.some((v) => typeof v !== 'string' || v.length > 10000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v))) return null
      size += key.length + values.reduce((sum, v) => sum + v.length, 0)
      if (size > 60000) return null
      formValues[key] = Array.isArray(item) ? values : values[0]!
    }
  }
  const eventId = optional(data.event_id ?? envelope.event_id ?? header.event_id, 512)
  const token = optional(data.token, 512)
  if (!eventId && (value.startsWith('surface:') || value.startsWith('approval:'))) return null
  const appId = optional(header.app_id ?? envelope.app_id ?? data.app_id, 256)
  const time = Number(data.create_time ?? envelope.create_time ?? header.create_time) / 1000
  return {
    eventId:
      eventId ?? (token ? `card-token:${segment(token)}` : `card:${messageId}:${userId}:${value}`),
    ...(appId ? { appId } : {}),
    chatId,
    messageId,
    userId,
    value,
    ...(chatType ? { chatType } : {}),
    ...(cardChatId ? { cardChatId } : {}),
    ...(formValues ? { formValues } : {}),
    at: new Date(Number.isFinite(time) && time > 0 && time < 8.64e15 ? time : Date.now()).toISOString(),
  }
}
export const segment = (value: string) => createHash('sha256').update(value).digest('hex')
