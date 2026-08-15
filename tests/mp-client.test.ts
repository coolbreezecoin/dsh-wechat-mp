import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MpClient, TokenManager, WeChatApiError } from '../src/mp-client/index.ts'

const BASE = 'https://api.example.test'

interface Recorded {
  url: URL
  init: RequestInit | undefined
}

/** A fetch stand-in that replays queued JSON bodies and records each request. */
function stubFetch(bodies: unknown[]): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  const queue = [...bodies]
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init })
    const body = queue.shift()
    if (body === undefined) throw new Error('stub fetch: no queued response')
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

let cacheDir: string

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'dsh-mp-test-'))
})

async function makeImage(name: string, bytes: number): Promise<string> {
  const path = join(cacheDir, name)
  await writeFile(path, Buffer.alloc(bytes, 1))
  return path
}

function client(bodies: unknown[]): { mp: MpClient; calls: Recorded[] } {
  const { fetchImpl, calls } = stubFetch(bodies)
  const mp = new MpClient({ appId: 'wx-app', appSecret: 'secret', cacheDir, baseUrl: BASE, fetchImpl })
  return { mp, calls }
}

describe('TokenManager', () => {
  it('fetches once and serves the rest from cache', async () => {
    const { fetchImpl, calls } = stubFetch([{ access_token: 'T1', expires_in: 7200 }])
    const tokens = new TokenManager({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl })
    expect(await tokens.get()).toBe('T1')
    expect(await tokens.get()).toBe('T1')
    expect(calls).toHaveLength(1)
  })

  it('persists the token across instances so a new process does not burn a grant', async () => {
    const first = stubFetch([{ access_token: 'T1', expires_in: 7200 }])
    await new TokenManager({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl: first.fetchImpl }).get()

    const second = stubFetch([])
    const revived = new TokenManager({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl: second.fetchImpl })
    expect(await revived.get()).toBe('T1')
    expect(second.calls).toHaveLength(0)
  })

  it('refreshes before nominal expiry rather than at it', async () => {
    let now = 1_000_000
    const { fetchImpl, calls } = stubFetch([
      { access_token: 'T1', expires_in: 7200 },
      { access_token: 'T2', expires_in: 7200 },
    ])
    const tokens = new TokenManager({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl, now: () => now })
    expect(await tokens.get()).toBe('T1')

    // 4 minutes before expiry: inside the 5-minute safety margin.
    now += (7200 - 240) * 1000
    expect(await tokens.get()).toBe('T2')
    expect(calls).toHaveLength(2)
  })

  it('collapses concurrent refreshes into one grant', async () => {
    const { fetchImpl, calls } = stubFetch([{ access_token: 'T1', expires_in: 7200 }])
    const tokens = new TokenManager({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl })
    const all = await Promise.all([tokens.get(), tokens.get(), tokens.get()])
    expect(all).toEqual(['T1', 'T1', 'T1'])
    expect(calls).toHaveLength(1)
  })

  it('survives a corrupt cache file by refetching', async () => {
    const first = stubFetch([{ access_token: 'T1', expires_in: 7200 }])
    await new TokenManager({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl: first.fetchImpl }).get()

    const cacheFile = join(cacheDir, (await readdir(cacheDir)).find(f => f.startsWith('token-'))!)
    expect(await readFile(cacheFile, 'utf-8')).toContain('T1')
    await writeFile(cacheFile, '{ truncated')

    const second = stubFetch([{ access_token: 'T2', expires_in: 7200 }])
    const revived = new TokenManager({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl: second.fetchImpl })
    expect(await revived.get()).toBe('T2')
  })

  it('keeps separate cache files per account', async () => {
    const a = stubFetch([{ access_token: 'TA', expires_in: 7200 }])
    const b = stubFetch([{ access_token: 'TB', expires_in: 7200 }])
    await new TokenManager({ appId: 'app-a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl: a.fetchImpl }).get()
    await new TokenManager({ appId: 'app-b', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl: b.fetchImpl }).get()

    const files = (await readdir(cacheDir)).filter(f => f.startsWith('token-'))
    expect(files).toHaveLength(2)
    // The AppID must not be recoverable from the filename.
    expect(files.join(' ')).not.toContain('app-a')
  })

  it('turns a credential error into an actionable message', async () => {
    const { fetchImpl } = stubFetch([{ errcode: 40125, errmsg: 'invalid appsecret' }])
    const tokens = new TokenManager({ appId: 'a', appSecret: 'bad', cacheDir, baseUrl: BASE, fetchImpl })
    await expect(tokens.get()).rejects.toThrow(/AppSecret 不合法/)
  })

  it('names the IP allowlist for errcode 40164', async () => {
    const { fetchImpl } = stubFetch([{ errcode: 40164, errmsg: 'invalid ip' }])
    const tokens = new TokenManager({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl })
    await expect(tokens.get()).rejects.toThrow(/IP 白名单/)
  })
})

describe('MpClient', () => {
  it('uploads an in-article image and returns its wechat url', async () => {
    const { mp, calls } = client([
      { access_token: 'T1', expires_in: 7200 },
      { url: 'https://mmbiz.qpic.cn/abc' },
    ])
    const path = await makeImage('a.png', 1024)
    expect(await mp.uploadImage(path)).toBe('https://mmbiz.qpic.cn/abc')

    const upload = calls[1]!
    expect(upload.url.pathname).toBe('/cgi-bin/media/uploadimg')
    expect(upload.url.searchParams.get('access_token')).toBe('T1')
    expect(upload.init?.body).toBeInstanceOf(FormData)
    expect((upload.init?.body as FormData).get('media')).toBeInstanceOf(Blob)
  })

  it('rejects an oversized in-article image before spending a call', async () => {
    const { mp, calls } = client([{ access_token: 'T1', expires_in: 7200 }])
    const path = await makeImage('big.png', 2 * 1024 * 1024)
    await expect(mp.uploadImage(path)).rejects.toThrow(/超过微信的 1024KB 限制/)
    expect(calls).toHaveLength(0)
  })

  it('rejects an unsupported image format', async () => {
    const { mp } = client([])
    const path = await makeImage('a.webp', 100)
    await expect(mp.uploadImage(path)).rejects.toThrow(/只支持 jpg\/png/)
  })

  it('uploads a cover as a permanent thumb material', async () => {
    const { mp, calls } = client([
      { access_token: 'T1', expires_in: 7200 },
      { media_id: 'THUMB1', url: 'https://mmbiz.qpic.cn/t' },
    ])
    const path = await makeImage('cover.jpg', 4096)
    expect(await mp.uploadThumb(path)).toBe('THUMB1')
    expect(calls[1]!.url.pathname).toBe('/cgi-bin/material/add_material')
    expect(calls[1]!.url.searchParams.get('type')).toBe('thumb')
  })

  it('creates a draft and returns its media_id', async () => {
    const { mp, calls } = client([
      { access_token: 'T1', expires_in: 7200 },
      { media_id: 'DRAFT1' },
    ])
    const id = await mp.addDraft([{ title: '标题', content: '<p>正文</p>', author: '我' }])
    expect(id).toBe('DRAFT1')
    expect(calls[1]!.url.pathname).toBe('/cgi-bin/draft/add')
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({
      articles: [{ title: '标题', content: '<p>正文</p>', author: '我' }],
    })
  })

  it('retries once against a forced refresh when the token expired mid-flight', async () => {
    const { mp, calls } = client([
      { access_token: 'T1', expires_in: 7200 },
      { errcode: 42001, errmsg: 'access_token expired' },
      { access_token: 'T2', expires_in: 7200 },
      { media_id: 'DRAFT1' },
    ])
    expect(await mp.addDraft([{ title: 't', content: 'c' }])).toBe('DRAFT1')
    expect(calls).toHaveLength(4)
    expect(calls[3]!.url.searchParams.get('access_token')).toBe('T2')
  })

  it('does not retry a permission error, and explains what it means', async () => {
    const { mp, calls } = client([
      { access_token: 'T1', expires_in: 7200 },
      { errcode: 48001, errmsg: 'api unauthorized' },
    ])
    await expect(mp.addDraft([{ title: 't', content: 'c' }])).rejects.toThrow(/未认证的个人订阅号/)
    expect(calls).toHaveLength(2)
  })

  it('exposes the raw errcode for callers that branch on it', async () => {
    const { mp } = client([
      { access_token: 'T1', expires_in: 7200 },
      { errcode: 48001, errmsg: 'api unauthorized' },
    ])
    const error = await mp.addDraft([{ title: 't', content: 'c' }]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WeChatApiError)
    expect((error as WeChatApiError).errcode).toBe(48001)
  })

  it('lists drafts with their titles', async () => {
    const { mp, calls } = client([
      { access_token: 'T1', expires_in: 7200 },
      {
        item: [
          { media_id: 'D1', update_time: 100, content: { news_item: [{ title: '第一篇' }] } },
          { media_id: 'D2', update_time: 90, content: { news_item: [{ title: 'A' }, { title: 'B' }] } },
        ],
      },
    ])
    expect(await mp.listDrafts(5)).toEqual([
      { media_id: 'D1', update_time: 100, titles: ['第一篇'] },
      { media_id: 'D2', update_time: 90, titles: ['A', 'B'] },
    ])
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ offset: 0, count: 5, no_content: 1 })
  })

  it('surfaces a network failure as a transport error naming the endpoint', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const mp = new MpClient({ appId: 'a', appSecret: 's', cacheDir, baseUrl: BASE, fetchImpl })
    await expect(mp.addDraft([{ title: 't', content: 'c' }])).rejects.toThrow(/无法连接微信接口 \/cgi-bin\/token/)
  })
})
