import { FeishuError } from './errors.js'
import type { Credentials, Domain, Gateway, Media } from './contracts.js'
import { sdkSocket, type Socket, type SocketFactory } from './sdk-socket.js'
const origins = { feishu: 'https://open.feishu.cn', lark: 'https://open.larksuite.com' } as const
export class RealGateway implements Gateway {
  ready = false
  private socket: Socket | undefined
  private abort = new AbortController()
  private version = 0
  private credentials: Credentials | undefined
  private domain: Domain = 'feishu'
  private token: { value: string; expires: number } | undefined
  private tokenRequest: Promise<string> | undefined
  private removeAbort: (() => void) | undefined
  private rejectStart: ((error: Error) => void) | undefined
  constructor(private options: { fetchImpl?: typeof fetch; socketFactory?: SocketFactory } = {}) {}
  async start(
    credentials: Credentials,
    domain: Domain,
    onMessage: (raw: unknown) => Promise<void>,
    signal: AbortSignal,
  ) {
    await this.stop()
    signal.throwIfAborted()
    this.abort = new AbortController()
    this.domain = domain
    this.credentials = { ...credentials }
    const version = this.version
    const cancel = () => {
      void this.stop()
    }
    signal.addEventListener('abort', cancel, { once: true })
    this.removeAbort = () => signal.removeEventListener('abort', cancel)
    try {
      const bot = await this.json('/open-apis/bot/v3/info', 'GET')
      const botInfo = bot.bot as { open_id?: unknown } | undefined
      if (typeof botInfo?.open_id !== 'string' || !botInfo.open_id.length) throw new FeishuError('BOT_ID')
      if (version !== this.version) throw new FeishuError('CANCELLED')
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = () => {
          if (timer) clearTimeout(timer)
          if (this.rejectStart === cancelStart) this.rejectStart = undefined
        }
        const cancelStart = (error: Error) => {
          finish()
          reject(error)
        }
        const fail = () => {
          if (version !== this.version) return
          this.ready = false
          cancelStart(new FeishuError('CONNECT'))
        }
        timer = setTimeout(() => cancelStart(new FeishuError('CONNECT_TIMEOUT')), 25000)
        this.rejectStart = cancelStart
        try {
          this.socket = (this.options.socketFactory ?? sdkSocket)({
            credentials,
            domain,
            onReady: () => {
              if (version !== this.version) return
              this.ready = true
              finish()
              resolve()
            },
            onError: fail,
            onReconnecting: () => {
              if (version === this.version) this.ready = false
            },
            onReconnected: () => {
              if (version === this.version) this.ready = true
            },
          })
          void this.socket
            .start((raw) => {
              if (version === this.version && !this.abort.signal.aborted) return onMessage(raw)
              return Promise.resolve()
            })
            .catch(fail)
        } catch {
          fail()
        }
      })
      if (version !== this.version || signal.aborted) throw new FeishuError('CANCELLED')
      return { botId: botInfo.open_id }
    } catch (error) {
      if (version === this.version) await this.stop()
      throw error instanceof FeishuError ? error : new FeishuError('CONNECT')
    }
  }
  async stop() {
    this.version++
    this.ready = false
    this.abort.abort()
    this.removeAbort?.()
    this.removeAbort = undefined
    this.rejectStart?.(new FeishuError('CANCELLED'))
    this.rejectStart = undefined
    const socket = this.socket
    this.socket = undefined
    this.credentials = undefined
    this.token = undefined
    this.tokenRequest = undefined
    socket?.close()
  }
  private async request(path: string, method: string, body: unknown, auth: boolean): Promise<Response> {
    const version = this.version,
      domain = this.domain,
      signal = this.abort.signal
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (auth) headers.authorization = 'Bearer ' + (await this.accessToken())
    if (version !== this.version || signal.aborted) throw new FeishuError('CANCELLED')
    try {
      const response = await (this.options.fetchImpl ?? fetch)(origins[domain] + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        throw new FeishuError('REDIRECT', response.status)
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new FeishuError('HTTP', response.status)
      }
      return response
    } catch (error) {
      if (error instanceof FeishuError) throw error
      throw new FeishuError(this.abort.signal.aborted ? 'CANCELLED' : 'NETWORK')
    }
  }
  private async bytes(response: Response, limit: number): Promise<Uint8Array> {
    const size = Number(response.headers.get('content-length'))
    if (size > limit) {
      await response.body?.cancel()
      throw new FeishuError('LIMIT')
    }
    const reader = response.body?.getReader()
    if (!reader) return new Uint8Array()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        this.abort.signal.throwIfAborted()
        const part = await reader.read()
        if (part.done) break
        length += part.value.length
        if (length > limit) throw new FeishuError('LIMIT')
        chunks.push(part.value)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error instanceof FeishuError
        ? error
        : new FeishuError(this.abort.signal.aborted ? 'CANCELLED' : 'NETWORK')
    } finally {
      reader.releaseLock()
    }
    const out = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
  private async json(
    path: string,
    method: string,
    body?: unknown,
    auth = true,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(path, method, body, auth)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(new TextDecoder().decode(await this.bytes(response, 512 * 1024)))
    } catch (error) {
      if (error instanceof FeishuError) throw error
      throw new FeishuError('RESPONSE')
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.code !== 0)
      throw new FeishuError('API', typeof data?.code === 'number' ? data.code : undefined)
    return data
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60000) return this.token.value
    if (this.tokenRequest) return this.tokenRequest
    const credentials = this.credentials
    if (!credentials) throw new FeishuError('CANCELLED')
    const version = this.version
    const pending = this.json(
      '/open-apis/auth/v3/tenant_access_token/internal',
      'POST',
      { app_id: credentials.appId, app_secret: credentials.appSecret },
      false,
    ).then((data) => {
      if (version !== this.version) throw new FeishuError('CANCELLED')
      if (typeof data.tenant_access_token !== 'string' || typeof data.expire !== 'number' || data.expire <= 0)
        throw new FeishuError('RESPONSE')
      this.token = { value: data.tenant_access_token, expires: Date.now() + data.expire * 1000 }
      return this.token.value
    })
    this.tokenRequest = pending
    try {
      return await pending
    } finally {
      if (this.tokenRequest === pending) this.tokenRequest = undefined
    }
  }
  async download(messageId: string, media: Media, maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new FeishuError('LIMIT')
    if (messageId === '.' || messageId === '..' || media.key === '.' || media.key === '..')
      throw new FeishuError('RESPONSE')
    const response = await this.request(
      `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(media.key)}?type=${media.kind}`,
      'GET',
      undefined,
      true,
    )
    if (response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel()
      throw new FeishuError('RESPONSE')
    }
    return {
      bytes: await this.bytes(response, maxBytes),
      mime: response.headers.get('content-type')?.split(';')[0]?.trim() || media.mime,
    }
  }
  async send(chatId: string, text: string, uuid: string) {
    if (!this.ready) throw new FeishuError('NOT_CONNECTED')
    const result = await this.json('/open-apis/im/v1/messages?receive_id_type=chat_id', 'POST', {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
      uuid,
    })
    const data = result.data as { message_id?: unknown } | undefined
    if (typeof data?.message_id !== 'string' || !data.message_id) throw new FeishuError('SEND_UNCERTAIN')
    return data.message_id
  }
}
