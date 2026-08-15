/**
 * access_token acquisition and caching.
 *
 * WeChat issues one token per app with a two-hour life and a bounded number of daily
 * grants, and a fresh grant invalidates the previous token. Two systems sharing an
 * account therefore evict each other, so the cache is a real correctness concern and
 * not just an optimization.
 * @module
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { WeChatApiError, WeChatTransportError } from './errors.ts'

/** Refresh this far before nominal expiry so an in-flight call cannot straddle it. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

interface CachedToken {
  token: string
  /** Epoch milliseconds at which the token stops being usable. */
  expiresAt: number
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  errcode?: number
  errmsg?: string
}

export interface TokenManagerOptions {
  appId: string
  appSecret: string
  /** Directory holding the per-app token cache file. */
  cacheDir: string
  /** API origin; overridable so tests never touch the network. */
  baseUrl: string
  /** Injectable clock, in epoch milliseconds. */
  now?: () => number
  fetchImpl?: typeof fetch
}

/**
 * Holds one app's access_token, persisted across processes.
 *
 * The cache filename is derived from a hash of the AppID so the directory never
 * reveals which accounts a machine manages, and so two accounts cannot collide.
 */
export class TokenManager {
  private readonly options: TokenManagerOptions
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch
  private readonly cacheFile: string
  /** De-duplicates concurrent refreshes within this process. */
  private inFlight: Promise<string> | undefined
  private memory: CachedToken | undefined

  constructor(options: TokenManagerOptions) {
    this.options = options
    this.now = options.now ?? Date.now
    this.fetchImpl = options.fetchImpl ?? fetch
    const digest = createHash('sha256').update(options.appId).digest('hex').slice(0, 16)
    this.cacheFile = join(options.cacheDir, `token-${digest}.json`)
  }

  /**
   * Return a usable token, refreshing when the cached one is missing or near expiry.
   * @param signal - cancels an in-flight refresh.
   * @param force - discard the cached token first; used after a token-expiry errcode.
   * @returns the access_token.
   */
  async get(signal?: AbortSignal, force = false): Promise<string> {
    if (force) {
      this.memory = undefined
    } else {
      const usable = this.memory ?? await this.readCache()
      if (usable !== undefined && usable.expiresAt - REFRESH_MARGIN_MS > this.now()) {
        this.memory = usable
        return usable.token
      }
    }
    // A second caller during a refresh must wait for it rather than burn another
    // daily grant, which would also invalidate the token the first caller is about
    // to receive.
    this.inFlight ??= this.refresh(signal).finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  private async readCache(): Promise<CachedToken | undefined> {
    let raw: string
    try {
      raw = await readFile(this.cacheFile, 'utf-8')
    } catch {
      // No cache yet, or it was cleared: an absent cache is the ordinary first-run
      // state, not a failure worth surfacing.
      return undefined
    }
    try {
      const parsed = JSON.parse(raw) as Partial<CachedToken>
      if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return undefined
      return { token: parsed.token, expiresAt: parsed.expiresAt }
    } catch {
      // A truncated or hand-edited cache file must not break a render; refetch.
      return undefined
    }
  }

  private async writeCache(entry: CachedToken): Promise<void> {
    await mkdir(dirname(this.cacheFile), { recursive: true })
    // Write-then-rename so a concurrent reader never sees a partial file.
    const temp = `${this.cacheFile}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(entry), { encoding: 'utf-8', mode: 0o600 })
    await rename(temp, this.cacheFile)
  }

  private async refresh(signal?: AbortSignal): Promise<string> {
    const endpoint = '/cgi-bin/token'
    const url = new URL(endpoint, this.options.baseUrl)
    url.searchParams.set('grant_type', 'client_credential')
    url.searchParams.set('appid', this.options.appId)
    url.searchParams.set('secret', this.options.appSecret)

    let response: Response
    try {
      response = await this.fetchImpl(url, { signal: signal ?? null })
    } catch (error) {
      throw new WeChatTransportError(endpoint, error)
    }

    const body = await response.json() as TokenResponse
    if (typeof body.errcode === 'number' && body.errcode !== 0) {
      throw new WeChatApiError(body.errcode, body.errmsg ?? '', endpoint)
    }
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new WeChatApiError(-2, `unexpected token response: ${JSON.stringify(body)}`, endpoint)
    }

    const entry: CachedToken = {
      token: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    }
    this.memory = entry
    // A cache write failure costs an extra grant next process, which is far better
    // than failing the operation the caller actually asked for.
    await this.writeCache(entry).catch(() => undefined)
    return entry.token
  }
}
