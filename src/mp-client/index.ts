/**
 * WeChat Official Account API client. No Cordis, no harness types (PLAN 决策 2).
 * @module
 */

export { DEFAULT_BASE_URL, MpClient } from './client.ts'
export type { DraftArticle, DraftSummary, MpClientOptions } from './client.ts'
export { explain, WeChatApiError, WeChatTransportError } from './errors.ts'
export { TokenManager } from './token.ts'
export type { TokenManagerOptions } from './token.ts'
