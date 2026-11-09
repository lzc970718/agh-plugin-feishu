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
    case 'text':
      texts.push(required(content.text, 60000))
      break
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
    },
    media,
  }
}
export const segment = (value: string) => createHash('sha256').update(value).digest('hex')
