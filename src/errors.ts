export class FeishuError extends Error {
  constructor(
    readonly reason: string,
    readonly status?: number,
  ) {
    super(`Feishu ${reason}${status === undefined ? '' : ` (${status})`}`)
    this.name = 'FeishuError'
  }
}
export function mediaFailure(error: unknown): string {
  if (!(error instanceof FeishuError)) return '附件下载失败（DOWNLOAD_FAILED）'
  const known: Record<string, string> = {
    LIMIT: '附件合计超过 20 MiB',
    HTTP: '附件下载接口拒绝请求',
    NETWORK: '网络请求失败',
    RESPONSE: '接口返回无效',
    REDIRECT: '附件接口返回跳转，未转发鉴权信息',
    CANCELLED: '附件下载已取消',
  }
  return `${known[error.reason] ?? '附件下载失败'}（${Object.hasOwn(known, error.reason) ? error.reason : 'DOWNLOAD_FAILED'}${error.status ? ` ${error.status}` : ''}）`
}
