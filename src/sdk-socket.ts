import { WSClient, EventDispatcher, Domain as SdkDomain, LoggerLevel } from '@larksuiteoapi/node-sdk'
import type { Credentials, Domain } from './contracts.js'
export type SocketOptions = {
  credentials: Credentials
  domain: Domain
  onReady: () => void
  onError: () => void
  onReconnecting: () => void
  onReconnected: () => void
}
export interface Socket {
  start(handler: (raw: unknown) => Promise<void>, onCardAction: (raw: unknown) => Promise<void>): Promise<void>
  close(): void
}
export type SocketFactory = (options: SocketOptions) => Socket
export const sdkSocket: SocketFactory = (options) => {
  const ws = new WSClient({
    ...options.credentials,
    domain: options.domain === 'lark' ? SdkDomain.Lark : SdkDomain.Feishu,
    loggerLevel: LoggerLevel.error,
    logger: { error() {}, warn() {}, info() {}, debug() {}, trace() {} },
    autoReconnect: true,
    handshakeTimeoutMs: 15000,
    wsConfig: { pingTimeout: 30 },
    onReady: options.onReady,
    onError: options.onError,
    onReconnecting: options.onReconnecting,
    onReconnected: options.onReconnected,
  })
  return {
    start: (handler, onCardAction) =>
      ws.start({ eventDispatcher: new EventDispatcher({}).register(sdkHandlers(handler, onCardAction)) }),
    close: () => ws.close({ force: true }),
  }
}

/** `card.action.trigger` arrives on the same long connection as an event; the `{}` reply leaves the card unchanged. */
export function sdkHandlers(
  handler: (raw: unknown) => Promise<void>,
  onCardAction: (raw: unknown) => Promise<void>,
) {
  return {
    'im.message.receive_v1': queuedMessageHandler(handler),
    'card.action.trigger': queuedMessageHandler(onCardAction),
  }
}

/** Acknowledge after bounded in-memory admission, not after potentially slow media downloads. */
export function queuedMessageHandler(handler: (raw: unknown) => Promise<void>) {
  return async (raw: unknown) => {
    const pending = handler(raw)
    // Processing diagnostics stay inside the adapter and never reflect platform credentials.
    void pending.catch(() => {})
    return {}
  }
}
