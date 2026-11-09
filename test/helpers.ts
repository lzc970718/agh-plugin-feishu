import type { Gateway, Media, Credentials, Domain } from '../src/contracts.js'
export const payload = (type = 'text', content: unknown = { text: 'hello' }, group = false) => ({
  sender: { sender_type: 'user', sender_id: { open_id: 'ou_user' } },
  message: {
    message_id: 'om_message',
    chat_id: 'oc_chat',
    chat_type: group ? 'group' : 'p2p',
    message_type: type,
    content: JSON.stringify(content),
    create_time: '1760000000000',
    mentions: [],
  },
})
export class FakeGateway implements Gateway {
  ready = false
  handler: ((raw: unknown) => Promise<void>) | undefined
  downloads = new Map<string, { bytes: Uint8Array; mime: string } | Error>()
  sent: { chatId: string; text: string; uuid: string }[] = []
  async start(
    _credentials: Credentials,
    _domain: Domain,
    handler: (raw: unknown) => Promise<void>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted()
    this.ready = true
    this.handler = handler
    return { botId: 'ou_bot' }
  }
  async stop() {
    this.ready = false
  }
  async download(_id: string, media: Media, maxBytes: number) {
    const found = this.downloads.get(media.key)
    if (found instanceof Error) throw found
    if (!found || found.bytes.length > maxBytes) throw new Error('download failed')
    return found
  }
  async send(chatId: string, text: string, uuid: string) {
    this.sent.push({ chatId, text, uuid })
    return 'om_sent_' + this.sent.length
  }
  async emit(raw: unknown) {
    await this.handler?.(raw)
  }
}
export const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
