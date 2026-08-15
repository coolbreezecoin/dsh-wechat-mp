/**
 * WeChat Official Account API error codes, translated into something a human can act on.
 *
 * The platform returns `{ errcode, errmsg }` with HTTP 200 for business failures, so
 * every response has to be inspected rather than trusted by status code.
 * @module
 */

/** A business failure reported by the WeChat API. */
export class WeChatApiError extends Error {
  /** The platform's numeric error code. */
  readonly errcode: number
  /** The platform's own (English, terse) message. */
  readonly errmsg: string
  /** The API path that produced it, for context in a multi-step flow. */
  readonly endpoint: string

  constructor(errcode: number, errmsg: string, endpoint: string) {
    super(`${explain(errcode)} (errcode ${errcode}: ${errmsg}, ${endpoint})`)
    this.name = 'WeChatApiError'
    this.errcode = errcode
    this.errmsg = errmsg
    this.endpoint = endpoint
  }

  /** True when retrying after a forced token refresh can plausibly succeed. */
  get isTokenExpiry(): boolean {
    return this.errcode === 40001 || this.errcode === 42001 || this.errcode === 40014
  }
}

/**
 * Actionable explanation for the error codes this plugin can actually hit.
 * @param errcode - the platform's numeric code.
 * @returns a sentence telling the reader what to do about it.
 */
export function explain(errcode: number): string {
  switch (errcode) {
    case -1:
      return '微信服务器繁忙,稍后重试'
    case 40001:
      return 'AppSecret 错误,或 access_token 已失效。检查 WECHAT_MP_SECRET 是否与公众号一致'
    case 40002:
      return '凭证类型不合法'
    case 40007:
      return 'media_id 不合法。素材可能已过期(临时素材 3 天)或不属于本公众号'
    case 40013:
      return 'AppID 不合法。检查 WECHAT_MP_APPID'
    case 40014:
      return 'access_token 不合法,将自动刷新后重试'
    case 40125:
      return 'AppSecret 不合法。到公众平台「基本配置」重新确认 AppSecret'
    case 40164:
      return '调用方 IP 不在白名单内。到公众平台「基本配置 → IP 白名单」把当前出口 IP 加进去(家宽是动态 IP,换了就要重加)'
    case 41002:
      return '缺少 appid 参数'
    case 41004:
      return '缺少 secret 参数'
    case 42001:
      return 'access_token 已过期,将自动刷新后重试'
    case 45009:
      return '接口调用频率超限。access_token 每日获取次数有限,检查是否有其他系统在共用同一个公众号'
    case 45028:
      return '草稿箱已满'
    case 48001:
      return 'API 未授权。这个接口对当前公众号类型不开放——未认证的个人订阅号通常没有草稿箱和素材接口权限。排版结果仍可复制进后台编辑器手动发布'
    case 53500:
      return '发布功能被封禁'
    case 53501:
      return '频繁请求发布'
    case 9001002:
      return '接口未开通'
    default:
      return '微信接口调用失败'
  }
}

/** A transport-level failure: the request never produced a WeChat response body. */
export class WeChatTransportError extends Error {
  constructor(endpoint: string, cause: unknown) {
    super(`无法连接微信接口 ${endpoint}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'WeChatTransportError'
    this.cause = cause
  }
}
