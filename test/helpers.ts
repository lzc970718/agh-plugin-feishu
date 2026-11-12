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
export const cardClick = (value: unknown = { id: 'pick:1', t: 'dm' }, chat = 'oc_chat') => ({
  schema: '2.0',
  event_type: 'card.action.trigger',
  event_id: 'ev_click',
  create_time: '1760000000000000',
  operator: { open_id: 'ou_user' },
  token: 'c-token',
  action: { tag: 'button', value },
  context: { open_message_id: 'om_card', open_chat_id: chat },
})
export class FakeGateway implements Gateway {
  ready = false
  handler: ((raw: unknown) => Promise<void>) | undefined
  cardHandler: ((raw: unknown) => Promise<void>) | undefined
  sentCards: { chatId: string; card: Record<string, unknown>; uuid: string }[] = []
  updatedCards: { messageId: string; card: Record<string, unknown> }[] = []
  downloads = new Map<string, { bytes: Uint8Array; mime: string } | Error>()
  sent: { chatId: string; text: string; uuid: string }[] = []
  async start(
    _credentials: Credentials,
    _domain: Domain,
    handler: (raw: unknown) => Promise<void>,
    signal: AbortSignal,
    cardHandler: (raw: unknown) => Promise<void> = async () => {},
  ) {
    signal.throwIfAborted()
    this.ready = true
    this.handler = handler
    this.cardHandler = cardHandler
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
  async sendCard(chatId: string, card: Record<string, unknown>, uuid: string) {
    this.sentCards.push({ chatId, card, uuid })
    return 'om_card_' + this.sentCards.length
  }
  async updateText(_messageId: string, _markdown: string) {}
  async updateCard(messageId: string, card: Record<string, unknown>) {
    this.updatedCards.push({ messageId, card })
  }
  async emitCard(raw: unknown) {
    await this.cardHandler?.(raw)
  }
  async emit(raw: unknown) {
    await this.handler?.(raw)
  }
}
export const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
