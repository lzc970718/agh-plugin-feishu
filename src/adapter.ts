import { createHash, randomUUID } from 'node:crypto'
import type {
  ChannelAdapter,
  ChannelManifest,
  ChannelEvent,
  ConnectOptions,
  InboundIntent,
  ChannelCredential,
  ChannelMessage,
  ChatTarget,
  MessageRef,
  ApprovalView,
  RenderContext,
  Block,
  CardBlock,
  SlotActionIntent,
  ChannelSurfaceBlock,
  ChannelSurfaceAction,
} from '@agnes/plugin-runtime/channel-contract'
import { sessionKeyFor } from '@agnes/plugin-runtime/channel-contract'
import type { ContentBlock, UINode } from '@agnes/protocol'
import type { Domain, Gateway } from './contracts.js'
import { MAX_MEDIA_BYTES, MAX_MEDIA_COUNT, normalize, normalizeCardAction, segment } from './events.js'
import { FeishuError, mediaFailure } from './errors.js'
import { neutralizeMarkdown } from './markdown.js'
type ChatKind = ChannelEvent['chat']['type']
export class FeishuAdapter implements ChannelAdapter {
  private epoch = 0
  private connected = false
  private appId = ''
  private botId = ''
  private options: ConnectOptions | undefined
  private abort = new AbortController()
  private tail: Promise<void> = Promise.resolve()
  private queued = 0
  private connecting: Promise<{ botId: string }> | undefined
  private chats = new Map<string, ChatKind>()
  constructor(
    readonly manifest: ChannelManifest,
    private gateway: Gateway,
    private domain: Domain = 'feishu',
  ) {}
  async connect(options: ConnectOptions) {
    await this.disconnect()
    options.signal.throwIfAborted()
    const { appId, appSecret } = options.credentials
    if (
      typeof appId !== 'string' ||
      !appId ||
      appId.length > 256 ||
      typeof appSecret !== 'string' ||
      !appSecret ||
      appSecret.length > 4096
    )
      throw new FeishuError('CREDENTIALS')
    this.appId = appId
    this.options = options
    this.abort = new AbortController()
    const epoch = this.epoch
    const abort = () => {
      void this.disconnect().catch(() => {})
    }
    options.signal.addEventListener('abort', abort, { once: true })
    this.removeAbort = () => options.signal.removeEventListener('abort', abort)
    try {
      this.connecting = this.gateway.start(
        { appId, appSecret },
        this.domain,
        (raw) => this.receive(raw, epoch, (value) => this.deliver(value, epoch)),
        this.abort.signal,
        (raw) => this.receive(raw, epoch, (value) => this.deliverCardAction(value, epoch)),
      )
      const info = await this.connecting
      if (epoch !== this.epoch || options.signal.aborted) throw new FeishuError('CANCELLED')
      this.botId = info.botId
      this.connected = true
    } catch (error) {
      if (epoch === this.epoch) await this.disconnect()
      throw error
    }
  }
  private removeAbort: (() => void) | undefined
  async disconnect() {
    this.epoch++
    this.connected = false
    this.abort.abort()
    this.removeAbort?.()
    this.removeAbort = undefined
    this.options = undefined
    this.appId = ''
    this.botId = ''
    this.chats.clear()
    await this.gateway.stop()
    await this.tail
    this.connecting = undefined
    // Downloads are cancelled and drained before retirement is confirmed.
  }
  private receive(raw: unknown, epoch: number, process: (raw: unknown) => Promise<void>): Promise<void> {
    if (epoch !== this.epoch) return Promise.resolve()
    if (this.queued >= 64) throw new FeishuError('QUEUE_LIMIT')
    this.queued++
    const current = this.tail
      .catch(() => {})
      .then(async () => {
        try {
          await this.connecting
        } catch {
          return
        }
        await process(raw)
      })
      .finally(() => {
        this.queued--
      })
    this.tail = current.catch(() => {
      this.options?.log.warn('Feishu inbound processing failed')
    })
    return current
  }
  private async deliver(raw: unknown, epoch: number) {
    if (epoch !== this.epoch || !this.options || !this.connected) return
    let incoming: ReturnType<typeof normalize>
    try {
      incoming = normalize(raw, this.appId, this.botId)
    } catch {
      this.options.log.warn('Feishu invalid inbound event')
      return
    }
    if (!incoming) return
    const { event, media } = incoming
    const failed: string[] = []
    let remaining = MAX_MEDIA_BYTES
    for (const resource of media.slice(0, MAX_MEDIA_COUNT)) {
      try {
        if (remaining <= 0) throw new FeishuError('LIMIT')
        const downloaded = await this.gateway.download(event.messageId, resource, remaining)
        if (epoch !== this.epoch) return
        if (!(downloaded.bytes instanceof Uint8Array) || downloaded.bytes.length > remaining)
          throw new FeishuError('LIMIT')
        remaining -= downloaded.bytes.length
        event.attachments.push({
          name: resource.name,
          mime: downloaded.mime,
          bytes: downloaded.bytes,
          sizeBytes: downloaded.bytes.length,
        })
      } catch (error) {
        if (epoch !== this.epoch) return
        failed.push(JSON.stringify(resource.name) + '：' + mediaFailure(error))
      }
    }
    if (media.length > MAX_MEDIA_COUNT) failed.push('附件超过 50 个')
    if (failed.length)
      event.text += '\n[飞书附件未能同步：' + failed.join('；') + '。请检查应用权限、网络或文件大小后重发。]'
    if (epoch !== this.epoch || !this.options) return
    this.confirm(event.chat.id, event.chat.type)
    this.options.onEvent(event)
  }
  private confirm(chatId: string, type: ChatKind) {
    if (this.chats.size >= 1024 && !this.chats.has(chatId)) this.chats.delete(this.chats.keys().next().value!)
    this.chats.set(chatId, type)
  }
  private async deliverCardAction(raw: unknown, epoch: number) {
    if (epoch !== this.epoch || !this.options || !this.connected) return
    let click: ReturnType<typeof normalizeCardAction>
    try {
      click = normalizeCardAction(raw)
    } catch {
      this.options.log.warn('Feishu invalid card callback')
      return
    }
    if (!click) return
    if (click.appId && click.appId !== this.appId) return
    // A click answers only in the chat its card was sent to: a forwarded card must not act for another chat.
    if (click.cardChatId !== click.chatId) {
      this.options.log.warn('Feishu card callback from a chat other than the card chat')
      return
    }
    const type = this.chats.get(click.chatId) ?? click.chatType
    if (!type) {
      this.options.log.warn('Feishu card callback from an unknown chat type')
      return
    }
    this.confirm(click.chatId, type)
    this.options.onEvent({
      kind: 'cardAction',
      eventId: click.eventId,
      accountId: this.appId,
      at: click.at,
      chat: { id: click.chatId, type },
      sender: { userId: click.userId, raw: {} },
      cardBizId: click.messageId,
      value: click.value,
      ...(click.formValues ? { formValues: click.formValues } : {}),
    })
  }
  toSession(event: ChannelEvent, context: { tenant: string; agent: string }): InboundIntent | null {
    if (event.kind !== 'message') return null
    const content: ContentBlock[] = event.text.trim() ? [{ type: 'text', text: event.text.trim() }] : []
    for (const attachment of event.attachments) {
      if (!attachment.bytes || attachment.bytes.length > MAX_MEDIA_BYTES) continue
      const bytes = attachment.bytes,
        data = Buffer.from(bytes).toString('base64')
      const mime =
        bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
          ? 'image/png'
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? 'image/jpeg'
            : undefined
      if (mime) content.push({ type: 'image', data, mimeType: mime })
      else
        content.push({
          type: 'file',
          data,
          name: attachment.name,
          mimeType: /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(attachment.mime)
            ? attachment.mime
            : 'application/octet-stream',
        })
    }
    if (!content.length) return null
    return {
      sessionKey: sessionKeyFor({
        ...context,
        channel: this.manifest.id,
        chat: { ...event.chat, id: segment(event.chat.id) },
      }),
      credential: this.credentialOf(event),
      eventId: event.eventId,
      messageId: event.messageId,
      content,
      kind: 'message',
    }
  }
  resolveScope(event: ChannelEvent) {
    return { scope: event.chat.id, isDirectMessage: event.chat.type === 'dm' }
  }
  credentialOf(event: ChannelEvent): ChannelCredential {
    return {
      kind: 'channel',
      channel: this.manifest.id,
      accountId: event.accountId,
      userId: event.sender.userId,
      chatId: event.chat.id,
      chatType: event.chat.type,
      raw: {},
    }
  }
  capabilities() {
    return { ...this.manifest.capabilities }
  }
  render(node: UINode, _context: RenderContext): ChannelMessage | null {
    if (node.kind === 'assistant') return { blocks: [{ kind: 'text', markdown: node.text }] }
    if (node.kind === 'artifact')
      return { blocks: [{ kind: 'text', markdown: `附件：${node.name}（请在 AGH 中查看）` }] }
    return null
  }
  renderApproval(request: ApprovalView, decisionKey?: string): ChannelMessage {
    return { blocks: [{ kind: 'approval', title: '需要审批', ...request, ...(decisionKey ? { decisionKey } : {}) }] }
  }
  onApprovalAction(event: ChannelEvent) {
    if (event.kind !== 'cardAction' || !event.value.startsWith('approval:')) return null
    try {
      const value = JSON.parse(event.value.slice(9)) as { d?: unknown; r?: unknown; v?: unknown }
      if (!['allowed-once', 'allowed-session', 'rejected'].includes(String(value.v))) return null
      const verdict = value.v as 'allowed-once' | 'allowed-session' | 'rejected'
      const approverCredential = this.credentialOf(event)
      if (typeof value.d === 'string' && value.d.length > 0 && value.d.length <= 512)
        return { decisionKey: value.d, verdict, approverCredential }
      if (typeof value.r === 'number' && Number.isSafeInteger(value.r) && value.r > 0)
        return { requestSeq: value.r, verdict, approverCredential }
    } catch {}
    return null
  }
  onSurfaceAction(event: ChannelEvent): ChannelSurfaceAction | null {
    if (event.kind !== 'cardAction' || !event.value.startsWith('surface:') || !event.formValues) return null
    try {
      const meta = JSON.parse(event.value.slice(8)) as { s: unknown; u: unknown; r: unknown; a: unknown; f: unknown }
      if (typeof meta.s !== 'string' || !meta.s || typeof meta.u !== 'string' || !meta.u ||
          typeof meta.a !== 'string' || !meta.a || typeof meta.r !== 'number' || !Number.isSafeInteger(meta.r) || meta.r < 1 ||
          !Array.isArray(meta.f) || meta.f.length > 64) return null
      const input: ChannelSurfaceAction['input'] = Object.create(null)
      const selection: ChannelSurfaceAction['selection'] = Object.create(null)
      for (const [i, entry] of meta.f.entries()) {
        if (!Array.isArray(entry) || entry.length !== 5 || typeof entry[0] !== 'string' || !entry[0] ||
            (entry[1] !== 'input' && entry[1] !== 'selection') || (entry[2] !== null && (typeof entry[2] !== 'string' || !entry[2])) ||
            typeof entry[3] !== 'boolean' || !['text', 'single', 'multi'].includes(entry[4])) return null
        let value = event.formValues[`f${i}`]
        if (entry[3]) {
          const custom = event.formValues[`x${i}`]
          if (custom !== undefined && typeof custom !== 'string') return null
          const additional = custom?.trim()
          if (additional) {
            if (entry[4] === 'multi') {
              if (value !== undefined && !Array.isArray(value)) return null
              value = [...new Set([...(value ?? []), ...additional.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean)])]
              if (value.length > 100) return null
            } else value = additional
          }
        }
        if (value === undefined) continue
        if (entry[1] === 'selection') selection[entry[0]] = Array.isArray(value) ? value : [value]
        else if (entry[2]) {
          const key = entry[2] as string
          const existing = input[key]
          if (existing !== undefined && (!existing || typeof existing !== 'object' || Array.isArray(existing))) return null
          input[key] = { ...(existing ?? {}), [entry[0]]: value }
        } else input[entry[0]] = value
      }
      return { sessionId: meta.s, surfaceId: meta.u, revision: meta.r, actionId: meta.a, input, selection }
    } catch { return null }
  }
  onSlotAction(event: ChannelEvent): SlotActionIntent | null {
    if (event.kind !== 'cardAction') return null
    const match = /^slot:(\d+):(.+)$/.exec(event.value)
    const requestSeq = Number(match?.[1])
    if (!match || !Number.isSafeInteger(requestSeq) || requestSeq < 1 || match[2]!.length > 128) return null
    return { requestSeq, actionId: match[2]!, credential: this.credentialOf(event) }
  }
  async update(reference: MessageRef, message: ChannelMessage): Promise<void> {
    const type = this.chats.get(reference.chatId) ?? reference.chatType
    if (!this.connected || !this.gateway.ready || !type || (reference.accountId && reference.accountId !== this.appId)) throw new FeishuError('TARGET_UNCONFIRMED')
    if (!reference.messageId || (reference.cardBizId && reference.cardBizId !== reference.messageId))
      throw new FeishuError('EDIT_UNSUPPORTED')
    const block = message.blocks.length === 1 ? message.blocks[0] : undefined
    if (!reference.cardBizId) {
      if (block?.kind !== 'text' || [...block.markdown].length > 8000) throw new FeishuError('EDIT_UNSUPPORTED')
      const epoch = this.epoch
      await this.gateway.updateText(reference.messageId, neutralizeMarkdown(block.markdown))
      if (epoch !== this.epoch) throw new FeishuError('CANCELLED')
      return
    }
    const card = block?.kind === 'card' ? cardPayload(block, type, reference.chatId)
      : block?.kind === 'surface' ? surfacePayload(block, type, reference.chatId)
      : block?.kind === 'approval' ? approvalPayload(block, type, reference.chatId)
      : block?.kind === 'text' ? cardPayload({ kind: 'card', title: '', body: block.markdown }, type, reference.chatId)
      : null
    if (!card) throw new FeishuError('EDIT_UNSUPPORTED')
    if (new TextEncoder().encode(JSON.stringify(card)).length > this.manifest.limits.cardBytes) throw new FeishuError('TOO_LARGE')
    const epoch = this.epoch
    await this.gateway.updateCard(reference.messageId, card)
    if (epoch !== this.epoch) throw new FeishuError('CANCELLED')
  }
  async send(target: ChatTarget, message: ChannelMessage): Promise<MessageRef> {
    const type = this.chats.get(target.chatId) ??
      (target.accountId === this.appId ? target.chatType : undefined)
    if (!this.connected || !this.gateway.ready || !type || (target.accountId && target.accountId !== this.appId))
      throw new FeishuError('TARGET_UNCONFIRMED')
    if (message.blocks.length !== 1 && message.blocks.some((b) => b.kind === 'surface' || b.kind === 'approval'))
      throw new FeishuError('EDIT_UNSUPPORTED')
    const epoch = this.epoch
    let sequence = 0,
      last = '',
      cardId = ''
    const key = target.deliveryKey ?? randomUUID()
    const uuidOf = (part: string) =>
      createHash('sha256')
        .update(JSON.stringify([key, sequence++, part]))
        .digest('hex')
        .slice(0, 48)
    const settled = () => {
      if (epoch !== this.epoch) throw new FeishuError('CANCELLED')
    }
    let run: string[] = []
    const flush = async () => {
      const chars = [...neutralizeMarkdown(run.filter(Boolean).join('\n\n'))]
      run = []
      for (let index = 0; index < chars.length; index += 8000) {
        settled()
        const part = chars.slice(index, index + 8000).join('')
        last = await this.gateway.send(target.chatId, part, uuidOf(part))
        settled()
      }
    }
    for (const block of message.blocks) {
      if (block.kind !== 'card' && block.kind !== 'surface' && block.kind !== 'approval') {
        run.push(blockText(block))
        continue
      }
      await flush()
      const card = block.kind === 'card' ? cardPayload(block, type, target.chatId)
        : block.kind === 'surface' ? surfacePayload(block, type, target.chatId)
        : approvalPayload(block, type, target.chatId)
      if (!card) continue
      if (new TextEncoder().encode(JSON.stringify(card)).length > this.manifest.limits.cardBytes)
        throw new FeishuError('TOO_LARGE')
      settled()
      last = cardId = await this.gateway.sendCard(target.chatId, card, uuidOf(JSON.stringify(card)))
      settled()
    }
    await flush()
    if (!last) throw new FeishuError('EMPTY_MESSAGE')
    return { chatId: target.chatId, messageId: cardId || last, accountId: this.appId, ...(type === 'dm' || type === 'group' ? { chatType: type } : {}), ...(cardId ? { cardBizId: cardId } : {}) }
  }
}
function blockText(block: Exclude<Block, CardBlock | ChannelSurfaceBlock | Extract<Block, { kind: 'approval' }>>): string {
  switch (block.kind) {
    case 'text':
      return block.markdown
    case 'link':
      return block.title + ' ' + block.url
    case 'file':
      return block.name + '（请在 AGH 中查看）'
    case 'table':
      return [block.title ? `【${block.title}】` : '', block.columns.join(' | '), ...block.rows.map((row) => row.join(' | '))]
        .filter(Boolean)
        .join('\n')
  }
}
/** Same short id the platform prints for text approvals, so "同意 <id>" keeps working with card support on. */
function approvalKey(block: Extract<Block, { kind: 'approval' }>): string | undefined {
  if (block.decisionKey) {
    try {
      const id = block.decisionKey.split('/').map(decodeURIComponent)[1]
      return id?.slice(0, 6)
    } catch {
      return undefined
    }
  }
  return block.requestSeq === undefined ? undefined : `#${block.requestSeq}`
}
const BUTTON_TYPE = { primary: 'primary', danger: 'danger' } as const
/** Schema 2.0 card. Button values are `{ id, t, c }`: the action id, plus the chat type and the chat the card was sent to, so a click survives a reconnect. */
function cardPayload(block: CardBlock, chatType: ChatKind, chatId: string): Record<string, unknown> | null {
  const markdown = [block.body, ...(block.fields ?? []).map(([name, value]) => `**${name}**: ${value}`)]
    .filter(Boolean)
    .join('\n')
  const elements: unknown[] = markdown ? [{ tag: 'markdown', content: neutralizeMarkdown(markdown) }] : []
  for (const action of block.actions ?? [])
    elements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: action.label },
      type: (action.style && BUTTON_TYPE[action.style]) ?? 'default',
      behaviors: [
        {
          type: 'callback',
          value: {
            id: block.requestSeq === undefined ? action.id : `slot:${block.requestSeq}:${action.id}`,
            t: chatType,
            c: chatId,
          },
        },
      ],
    })
  if (!block.title && !elements.length) return null
  return {
    schema: '2.0',
    config: { update_multi: true },
    ...(block.title ? { header: { title: { tag: 'plain_text', content: block.title } } } : {}),
    body: { elements },
  }
}

function approvalPayload(block: Extract<Block, { kind: 'approval' }>, chatType: ChatKind, chatId: string) {
  const choices = {
    allow_once: { label: '本次允许', verdict: 'allowed-once', style: 'primary' },
    allow_always: { label: '本会话允许', verdict: 'allowed-session', style: 'primary' },
    reject_once: { label: '本次拒绝', verdict: 'rejected', style: 'danger' },
  } as const
  const actions: NonNullable<CardBlock['actions']> = []
  for (const option of block.options) {
    if (!(option in choices)) continue
    const choice = choices[option as keyof typeof choices]
    if (!block.decisionKey && !block.requestSeq) continue
    const id = 'approval:' + JSON.stringify({ ...(block.decisionKey ? { d: block.decisionKey } : { r: block.requestSeq }), v: choice.verdict })
    if (id.length <= 512) actions.push({ id, label: choice.label, style: choice.style })
  }
  const key = approvalKey(block)
  return cardPayload({
    kind: 'card', title: block.title,
    body: [block.summary, `风险：${block.risk}`, block.expiresAt ? `截止：${block.expiresAt}` : '',
      key ? `也可回复「同意 ${key}」或「拒绝 ${key}」` : ''].filter(Boolean).join('\n'),
    actions,
  }, chatType, chatId)
}

function surfacePayload(block: ChannelSurfaceBlock, chatType: ChatKind, chatId: string): Record<string, unknown> {
  const elements: Record<string, unknown>[] = []
  if (block.body) elements.push({ tag: 'markdown', content: neutralizeMarkdown(block.body) })
  if (block.form.state === 'closed') {
    elements.push({ tag: 'markdown', content: neutralizeMarkdown(block.form.summary) })
  } else {
    const metadata = 'surface:' + JSON.stringify({ s: block.sessionId, u: block.surfaceId, r: block.revision,
      a: block.form.actionId, f: block.form.fields.map((field) => [field.name, field.binding, field.inputKey ?? null, field.kind !== 'text' && field.allowFreeText === true, field.kind]) })
    if (metadata.length <= 512 && block.form.fields.length <= 64) {
      const fields: Record<string, unknown>[] = []
      for (const [i, field] of block.form.fields.entries()) {
        const custom = field.kind !== 'text' && field.allowFreeText === true
        const common = { name: `f${i}`, required: field.required && !custom }
        if (field.kind === 'text') fields.push({ tag: 'input', ...common, label: { tag: 'plain_text', content: field.label },
          ...(field.multiline ? { input_type: 'multiline_text' } : {}),
          max_length: Math.min(Number.isInteger(field.maxLength) && field.maxLength! > 0 ? field.maxLength! : 1000, 1000) })
        else {
          if (field.options.length) fields.push({ tag: field.kind === 'single' ? 'select_static' : 'multi_select_static', ...common,
            placeholder: { tag: 'plain_text', content: field.label },
            options: field.options.map((option) => ({ text: { tag: 'plain_text', content: option.label }, value: option.value })) })
          if (custom) fields.push({ tag: 'input', name: `x${i}`, max_length: 1000, required: field.required && !field.options.length,
            label: { tag: 'plain_text', content: field.options.length ? '其他（可填写）' : field.label },
            ...(field.kind === 'multi' ? { input_type: 'multiline_text', placeholder: { tag: 'plain_text', content: '每行填写一项' } } : {}) })
        }
      }
      for (const field of block.form.fields) if (field.kind !== 'text') {
        for (const option of field.options) if (option.description)
          elements.push({ tag: 'markdown', content: neutralizeMarkdown(`${option.label}：${option.description}`) })
      }
      if (block.form.fields.some((field) => field.kind === 'text'
        ? !Number.isInteger(field.maxLength) || field.maxLength! > 1000 || field.maxLength! < 1
        : field.allowFreeText === true)) {
        elements.push({ tag: 'markdown', content: neutralizeMarkdown(`飞书输入框最多填写 1000 个字符；较长的回答请在 AGH 中填写：${block.fallbackUrl}`) })
      }
      fields.push({ tag: 'button', name: 'submit', form_action_type: 'submit', type: 'primary',
        text: { tag: 'plain_text', content: block.form.submitLabel },
        behaviors: [{ type: 'callback', value: { id: metadata, t: chatType, c: chatId } }] })
      elements.push({ tag: 'form', name: 'question', elements: fields })
    } else {
      elements.push({ tag: 'markdown', content: neutralizeMarkdown(`请在 AGH 中填写：${block.fallbackUrl}`) })
    }
  }
  return { schema: '2.0', config: { update_multi: true },
    header: { title: { tag: 'plain_text', content: block.title } }, body: { elements } }
}
