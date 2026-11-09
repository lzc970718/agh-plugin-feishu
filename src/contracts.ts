export type Domain = 'feishu' | 'lark'
export type Credentials = { appId: string; appSecret: string }
export type Media = { key: string; kind: 'image' | 'file'; name: string; mime: string }
export interface Gateway {
  readonly ready: boolean
  start(
    credentials: Credentials,
    domain: Domain,
    onMessage: (raw: unknown) => Promise<void>,
    signal: AbortSignal,
  ): Promise<{ botId: string }>
  stop(): Promise<void>
  download(messageId: string, media: Media, maxBytes: number): Promise<{ bytes: Uint8Array; mime: string }>
  send(chatId: string, text: string, uuid: string): Promise<string>
}
