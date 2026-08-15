/**
 * A thin, dependency-free wrapper over the WeChat Official Account REST API.
 *
 * Zero Cordis: this module is what survives a breaking harness change (PLAN 决策 2),
 * and it is unit-testable by injecting `fetchImpl`.
 * @module
 */

import { basename, extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { WeChatApiError, WeChatTransportError } from './errors.ts'
import { TokenManager } from './token.ts'

export { WeChatApiError, WeChatTransportError } from './errors.ts'

/** Default API origin. Overridable so tests and proxies can redirect it. */
export const DEFAULT_BASE_URL = 'https://api.weixin.qq.com'

/** `media/uploadimg` rejects anything larger; checked locally for a clearer error. */
const IN_ARTICLE_IMAGE_LIMIT_BYTES = 1024 * 1024

/** Image formats the in-article upload endpoint accepts. */
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])

export interface MpClientOptions {
  appId: string
  appSecret: string
  /** Directory for the access_token cache file. */
  cacheDir: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

/** One article in a draft. Field names mirror the platform's own JSON. */
export interface DraftArticle {
  title: string
  content: string
  author?: string
  digest?: string
  thumb_media_id?: string
  content_source_url?: string
  need_open_comment?: 0 | 1
  only_fans_can_comment?: 0 | 1
}

/** A draft as returned by `draft/batchget`. */
export interface DraftSummary {
  media_id: string
  update_time: number
  titles: string[]
}

interface ErrorBody {
  errcode?: number
  errmsg?: string
}

/**
 * REST client for one Official Account.
 *
 * Every call resolves an access_token first, and retries once against a forced
 * refresh when WeChat reports the token as expired — that race is normal near the
 * two-hour boundary and should not surface to the caller.
 */
export class MpClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly tokens: TokenManager

  constructor(options: MpClientOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.fetchImpl = options.fetchImpl ?? fetch
    this.tokens = new TokenManager({
      appId: options.appId,
      appSecret: options.appSecret,
      cacheDir: options.cacheDir,
      baseUrl: this.baseUrl,
      ...options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
      ...options.now ? { now: options.now } : {},
    })
  }

  /**
   * Perform one token-authenticated call, retrying once on a token-expiry code.
   * @param endpoint - API path, e.g. `/cgi-bin/draft/add`.
   * @param build - produces the RequestInit for a given attempt.
   * @param signal - caller cancellation.
   * @param query - extra query parameters beyond `access_token`.
   * @returns the parsed JSON body, already checked for `errcode`.
   */
  private async call<T>(
    endpoint: string,
    build: () => BodyInit | undefined,
    signal: AbortSignal | undefined,
    query: Record<string, string> = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.tokens.get(signal, attempt > 0)
      const url = new URL(endpoint, this.baseUrl)
      url.searchParams.set('access_token', token)
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

      const body = build()
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          signal: signal ?? null,
          ...body === undefined ? {} : { body },
        })
      } catch (error) {
        throw new WeChatTransportError(endpoint, error)
      }

      const parsed = await response.json() as T & ErrorBody
      if (typeof parsed.errcode === 'number' && parsed.errcode !== 0) {
        const error = new WeChatApiError(parsed.errcode, parsed.errmsg ?? '', endpoint)
        // A token can expire between the cache check and the server's read of it.
        // One forced refresh distinguishes that race from a genuinely bad secret.
        if (error.isTokenExpiry && attempt === 0) continue
        throw error
      }
      return parsed
    }
    // The loop either returns or throws; this satisfies the compiler's flow analysis.
    throw new Error(`unreachable: ${endpoint} retry loop exhausted`)
  }

  /**
   * Upload an in-article image and get back a `mmbiz.qpic.cn` URL.
   *
   * This endpoint does not consume the account's permanent-material quota and the
   * returned URL is only valid inside article bodies.
   * @param path - local image file, jpg or png, under 1 MB.
   * @param signal - caller cancellation.
   * @returns the WeChat-hosted image URL.
   */
  async uploadImage(path: string, signal?: AbortSignal): Promise<string> {
    const bytes = await this.readImage(path, IN_ARTICLE_IMAGE_LIMIT_BYTES, '正文图片')
    const result = await this.call<{ url?: string }>(
      '/cgi-bin/media/uploadimg',
      () => this.imageForm(path, bytes),
      signal,
    )
    if (typeof result.url !== 'string') {
      throw new WeChatApiError(-2, `uploadimg returned no url: ${JSON.stringify(result)}`, '/cgi-bin/media/uploadimg')
    }
    return result.url
  }

  /**
   * Upload a permanent thumb material, which is what a draft's cover requires.
   * @param path - local image file, jpg or png.
   * @param signal - caller cancellation.
   * @returns the `media_id` to use as `thumb_media_id`.
   */
  async uploadThumb(path: string, signal?: AbortSignal): Promise<string> {
    // The cover is a permanent material and allows a larger file than an in-article
    // image, so only the format check applies here.
    const bytes = await this.readImage(path, Number.POSITIVE_INFINITY, '封面图')
    const result = await this.call<{ media_id?: string }>(
      '/cgi-bin/material/add_material',
      () => this.imageForm(path, bytes),
      signal,
      { type: 'thumb' },
    )
    if (typeof result.media_id !== 'string') {
      throw new WeChatApiError(-2, `add_material returned no media_id: ${JSON.stringify(result)}`, '/cgi-bin/material/add_material')
    }
    return result.media_id
  }

  /**
   * Create a draft. The draft is not published; a human still confirms it in the
   * Official Account console.
   * @param articles - one or more articles to place in the draft.
   * @param signal - caller cancellation.
   * @returns the draft's `media_id`.
   */
  async addDraft(articles: DraftArticle[], signal?: AbortSignal): Promise<string> {
    if (articles.length === 0) throw new Error('addDraft requires at least one article')
    const payload = JSON.stringify({ articles })
    const result = await this.call<{ media_id?: string }>(
      '/cgi-bin/draft/add',
      () => payload,
      signal,
    )
    if (typeof result.media_id !== 'string') {
      throw new WeChatApiError(-2, `draft/add returned no media_id: ${JSON.stringify(result)}`, '/cgi-bin/draft/add')
    }
    return result.media_id
  }

  /**
   * List recent drafts, newest first.
   * @param count - how many to return, 1..20.
   * @param signal - caller cancellation.
   * @returns one summary per draft.
   */
  async listDrafts(count: number, signal?: AbortSignal): Promise<DraftSummary[]> {
    const payload = JSON.stringify({ offset: 0, count, no_content: 1 })
    const result = await this.call<{
      item?: { media_id?: string; update_time?: number; content?: { news_item?: { title?: string }[] } }[]
    }>('/cgi-bin/draft/batchget', () => payload, signal)

    return (result.item ?? []).map(entry => ({
      media_id: entry.media_id ?? '',
      update_time: entry.update_time ?? 0,
      titles: (entry.content?.news_item ?? []).map(article => article.title ?? ''),
    }))
  }

  /**
   * Read and validate a local image before spending an API call on it.
   * @param path - local file path.
   * @param limitBytes - endpoint's size ceiling.
   * @param label - what the image is, for the error message.
   * @returns the file contents.
   */
  private async readImage(path: string, limitBytes: number, label: string): Promise<Buffer> {
    const extension = extname(path).toLowerCase()
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`${label}只支持 jpg/png,拿到的是 ${extension || '(无扩展名)'}: ${path}`)
    }
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch (error) {
      throw new Error(`读不到${label} ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (bytes.byteLength > limitBytes) {
      const kb = Math.round(bytes.byteLength / 1024)
      throw new Error(`${label} ${path} 有 ${kb}KB,超过微信的 ${Math.round(limitBytes / 1024)}KB 限制,先压缩再传`)
    }
    return bytes
  }

  /**
   * Build the multipart body both upload endpoints expect.
   * @param path - source path, used for the part's filename.
   * @param bytes - file contents.
   * @returns a FormData carrying the `media` part.
   */
  private imageForm(path: string, bytes: Buffer): FormData {
    const form = new FormData()
    const extension = extname(path).toLowerCase()
    const type = extension === '.png' ? 'image/png' : 'image/jpeg'
    // A fresh view per attempt: a Blob may not be re-read after a retry consumed it.
    form.append('media', new Blob([new Uint8Array(bytes)], { type }), basename(path))
    return form
  }
}
