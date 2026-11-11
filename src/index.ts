import type { PluginContextFacets } from '@agnes/plugin-runtime'
import type { ChannelProvider, ChannelConfiguration } from '@agnes/plugin-runtime/channel-contract'
import manifestJson from './channel.json' with { type: 'json' }
import { FeishuAdapter } from './adapter.js'
import { RealGateway } from './gateway.js'
export const feishuProvider: ChannelProvider = {
  id: 'feishu',
  version: '0.1.3',
  manifest: manifestJson as ChannelProvider['manifest'],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      domain: { type: 'string', title: '平台区域 / Platform', enum: ['feishu', 'lark'], default: 'feishu' },
    },
  },
  create({ config }) {
    if (
      !config ||
      typeof config !== 'object' ||
      Array.isArray(config) ||
      Object.keys(config).some((key) => key !== 'domain') ||
      (config.domain !== undefined && config.domain !== 'feishu' && config.domain !== 'lark')
    )
      throw new Error('Invalid Feishu config')
    return new FeishuAdapter(this.manifest, new RealGateway(), config.domain === 'lark' ? 'lark' : 'feishu')
  },
}
export const main = {
  inject: ['profileRuntime', 'services', 'providers'],
  apply(ctx: Pick<PluginContextFacets, 'profileRuntime'>, config: Partial<ChannelConfiguration> = {}) {
    if (!ctx.profileRuntime.registerChannel) throw new Error('Feishu requires AGH channel bridge API 5.13.0')
    ctx.profileRuntime.registerChannel(feishuProvider, { instances: config.instances ?? [] })
  },
}
